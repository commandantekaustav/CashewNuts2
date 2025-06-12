import os
import json
import re
from datetime import datetime, timedelta
from dotenv import load_dotenv
import pypdf
import google.generativeai as genai
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import firebase_admin
from firebase_admin import credentials, auth

load_dotenv()

# --- Firebase Admin SDK Initialization ---
try:
    cred = credentials.Certificate("firebase-service-account.json")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
except Exception as e:
    print(f"CRITICAL: Error initializing Firebase: {e}")
    exit()

# --- Gemini Configuration ---
try:
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not found")
    genai.configure(api_key=GEMINI_API_KEY)
except Exception as e:
    print(f"CRITICAL: Error configuring Gemini: {e}")
    exit()

# --- FastAPI App & CORS ---
app = FastAPI()
origins = [
    "http://localhost:3000",
    "https://cashewnuts2.netlify.app"
]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# --- Gemini Prompt Templates ---
prompt_initial_analysis = """
You are an expert AI assistant acting as a highly critical, unbiased, Senior Staff Engineer conducting a pre-screen analysis. Your standards are exceptionally high. Your goal is to rigorously evaluate a candidate's resume against a job description.

**Job Description:**
\"\"\"
{job_description}
\"\"\"

**Candidate's Resume Text:**
\"\"\"
{resume_text}
\"\"\"

**Your Directives:**
1.  **Find Red Flags (Non-Date Related):** Scrutinize the resume for potential red flags like vague project descriptions, skill claims not supported by experience, or conflicting technical statements. **Do NOT analyze employment dates for overlaps or gaps; this will be handled separately.**
2.  **Be Unbiased:** Base your analysis strictly on the text provided.
3.  **Difficulty Level:** Generate questions with an average difficulty targeted at **{difficulty} out of 5**.
4.  **Output Format:** Generate a single, valid JSON object with no other text or markdown.

**JSON Structure:**
{{
  "candidateName": "The candidate's full name.",
  "confidenceScore": {{
    "score": <A number from 1-100 representing your confidence in this candidate's fit for the role>,
    "justification": "A brief, critical justification for your score."
  }},
  "potentialInconsistencies": [
      "A potential non-date-related inconsistency or red flag found in the resume."
  ],
  "projectNames": ["A list of project names found in the resume"],
  "categorizedQuestions": {{
    "Core Technical Skills": [
      {{
        "question": "A deep, specific question about a core technology.",
        "difficulty": <number 1-5>,
        "expectedAnswer": "A detailed, ideal answer demonstrating true expertise.",
        "keywords": ["keywords", "to", "listen", "for"],
        "nonTechnicalExplanation": "For the HR partner: This question tests..."
      }}
    ]
  }}
}}
"""

prompt_project_drilldown = """
You are a technical interviewer drilling down on a specific project from a candidate's resume. Your goal is to ask sharp, insightful questions to validate their claimed experience.

**Project Name:** "{project_name}"

**Full Resume Text:**
\"\"\"
{resume_text}
\"\"\"

**Instructions:**
Generate a single, valid JSON object containing an array of 3-4 highly specific questions about the chosen project.

**JSON Structure:**
{{
    "projectQuestions": [
        {{
          "question": "A very specific question about their contribution to the '{project_name}' project.",
          "difficulty": <number 3-5>,
          "expectedAnswer": "A convincing answer would detail the problem, the methodology for finding it, the solution implemented, and how the result was measured.",
          "keywords": ["bottleneck", "profiling", "trade-offs", "metrics", "my role"],
          "nonTechnicalExplanation": "For the HR partner: This question cuts through generic claims and forces the candidate to prove their specific, hands-on contribution to the project."
        }}
    ]
}}
"""

# --- Helper Functions and Auth ---
def extract_pdf_text(file_stream):
    try:
        pdf_reader = pypdf.PdfReader(file_stream)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text()
        return text
    except Exception as e:
        raise ValueError(f"Error reading PDF: {e}")

def analyze_work_history(text):
    date_pattern = re.compile(
        r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})\s*–\s*(Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})\b',
        re.IGNORECASE
    )
    month_map = {
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
        'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
    }
    found_ranges = []
    for match in date_pattern.finditer(text):
        try:
            start_month_str, start_year_str, end_str = match.groups()
            start_month = month_map[start_month_str.lower()[:3]]
            start_year = int(start_year_str)
            start_date = datetime(start_year, start_month, 1)
            end_date = None
            if end_str.lower() == 'present':
                end_date = datetime.now()
            else:
                end_month_str, end_year_str = end_str.split()
                end_month = month_map[end_month_str.lower()[:3]]
                end_year = int(end_year_str)
                end_date = datetime(end_year, end_month, 1)
            if start_date and end_date:
                found_ranges.append({"start": start_date, "end": end_date, "text": match.group(0)})
        except (ValueError, KeyError):
            continue
    if not found_ranges:
        return {"overlaps": [], "gaps": []}
    sorted_ranges = sorted(found_ranges, key=lambda x: x['start'])
    overlaps = []
    gaps = []
    for i in range(len(sorted_ranges) - 1):
        current_job = sorted_ranges[i]
        next_job = sorted_ranges[i+1]
        if current_job['end'] > next_job['start']:
            overlaps.append(f"Overlap detected: '{current_job['text']}' and '{next_job['text']}'")
        gap_duration = next_job['start'] - current_job['end']
        if gap_duration > timedelta(days=90):
            gap_months = round(gap_duration.days / 30)
            gaps.append(f"Potential {gap_months}-month gap found between '{current_job['text']}' and '{next_job['text']}'")
    return {"overlaps": overlaps, "gaps": gaps}

token_auth_scheme = HTTPBearer()
def get_current_user(cred: HTTPAuthorizationCredentials = Depends(token_auth_scheme)):
    try:
        decoded_token = auth.verify_id_token(cred.credentials)
        return decoded_token
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid credentials: {e}")

# --- API Endpoints ---
@app.get("/")
def read_root(): return {"message": "Resume Analyzer API is running."}

@app.post("/analyze-resume/")
async def analyze_resume(user: dict = Depends(get_current_user), file: UploadFile = File(...), job_description: str = Form(...), difficulty: int = Form(...)):
    if not file.content_type == "application/pdf":
        raise HTTPException(status_code=400, detail="Please upload a PDF.")
    try:
        resume_text = extract_pdf_text(file.file)
        date_analysis_results = analyze_work_history(resume_text)
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = prompt_initial_analysis.format(resume_text=resume_text, job_description=job_description, difficulty=difficulty)
        response = model.generate_content(prompt)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        json_response = json.loads(cleaned_response)
        json_response["dateAnalysis"] = date_analysis_results
        json_response["rawResumeText"] = resume_text
        json_response["jobDescription"] = job_description
        return json_response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")

class ProjectDrilldownRequest(BaseModel):
    resume_text: str
    project_name: str

@app.post("/project-questions/")
async def get_project_questions(request: ProjectDrilldownRequest, user: dict = Depends(get_current_user)):
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = prompt_project_drilldown.format(resume_text=request.resume_text, project_name=request.project_name)
        response = model.generate_content(prompt)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        json_response = json.loads(cleaned_response)
        return json_response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred during project drill-down: {e}")

class RegenerateRequest(BaseModel):
    resume_text: str
    job_description: str
    difficulty: int

@app.post("/regenerate-questions/")
async def regenerate_questions(request: RegenerateRequest, user: dict = Depends(get_current_user)):
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = prompt_initial_analysis.format(resume_text=request.resume_text, job_description=request.job_description, difficulty=request.difficulty)
        response = model.generate_content(prompt)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        json_response = json.loads(cleaned_response)
        return {"categorizedQuestions": json_response.get("categorizedQuestions", {})}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error during question regeneration: {e}")
