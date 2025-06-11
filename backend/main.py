# backend/main.py
import os
import json
from dotenv import load_dotenv
import pypdf
import google.generativeai as genai
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# NEW: Import firebase_admin for authentication
import firebase_admin
from firebase_admin import credentials, auth

# Load environment variables from a .env file for the Gemini API Key
load_dotenv()

# --- Firebase Admin SDK Initialization ---
# This section initializes the connection to your Firebase project
# It looks for the service account key file in the same directory.
try:
    cred = credentials.Certificate("firebase-service-account.json")
    firebase_admin.initialize_app(cred)
except Exception as e:
    print(f"CRITICAL: Error initializing Firebase Admin SDK: {e}")
    print("Ensure 'firebase-service-account.json' is in the 'backend' directory.")
    exit()


# --- Gemini Configuration ---
# This section configures the Gemini API with your secret key
try:
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not found in .env file")
    genai.configure(api_key=GEMINI_API_KEY)
except Exception as e:
    print(f"CRITICAL: Error configuring Gemini: {e}")
    print("Ensure your .env file contains a valid GEMINI_API_KEY.")
    exit()


# --- FastAPI App Initialization & CORS Configuration ---
# This creates the main application instance and allows the frontend to communicate with it.
app = FastAPI()

# IMPORTANT: Adjust origins if you deploy to a custom domain
origins = [
    "http://localhost:3000",  # Default React dev server
    # e.g., "https://your-frontend-app.onrender.com"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Gemini Prompt Templates ---

# Prompt for the initial, main analysis of the resume against a job description.
prompt_initial_analysis = """
You are an expert AI recruitment assistant. Your task is to analyze a candidate's resume against a specific job description and produce a comprehensive interview kit.

**Job Description:**
\"\"\"
{job_description}
\"\"\"

**Candidate's Resume Text:**
\"\"\"
{resume_text}
\"\"\"

**Instructions:**
Generate a single, valid JSON object as the output. Do not include any text or markdown formatting like ```json.
The JSON object must have the following structure:
{{
  "candidateName": "The candidate's full name, if found, otherwise 'Not Found'",
  "alignmentSummary": {{
    "summaryText": "A 2-3 sentence summary of how well the candidate's experience aligns with the job description.",
    "strengths": ["List of key strengths that match the job role."],
    "potentialGaps": ["List of potential gaps or areas not explicitly mentioned in the resume."]
  }},
  "categorizedQuestions": {{
    "Skill Match": [
        {{
          "question": "A question directly related to a skill mentioned in the job description AND the resume.",
          "difficulty": <number 1-5>,
          "expectedAnswer": "A detailed, ideal answer for this question.",
          "keywords": ["keywords", "to", "listen", "for", "in the candidate's answer"],
          "nonTechnicalExplanation": "A simple, non-technical explanation of the core concept being tested."
        }}
    ],
    "Behavioral": [
        {{
          "question": "A behavioral question to assess teamwork or problem-solving.",
          "difficulty": <number 1-5>,
          "expectedAnswer": "A detailed, ideal answer for this question, outlining a positive behavior.",
          "keywords": ["teamwork", "communication", "problem-solving"],
          "nonTechnicalExplanation": "This question assesses the candidate's soft skills and past behavior in a professional setting."
        }}
    ],
    "Project Experience": [
        {{
          "question": "A question about a specific project listed on the resume.",
          "difficulty": <number 1-5>,
          "expectedAnswer": "A detailed answer where the candidate explains their specific role and the outcome of the project.",
          "keywords": ["my role", "outcome", "challenge", "solution"],
          "nonTechnicalExplanation": "This verifies the candidate's actual experience and depth of involvement in their listed projects."
        }}
    ]
  }}
}}
"""

# Prompt for the deep-dive analysis focusing on projects and inconsistencies.
prompt_deep_dive = """
You are a senior technical interviewer conducting a deep-dive analysis of a candidate's resume. Your goal is to scrutinize their project experience, identify potential inconsistencies, and formulate highly specific, challenging questions.

**Candidate's Resume Text:**
\"\"\"
{resume_text}
\"\"\"

**Instructions:**
Generate a single, valid JSON object. Do not include any text outside the JSON object.
The JSON object must have the following structure:
{{
  "projectAnalyses": [
    {{
      "projectName": "Name of a specific project from the resume.",
      "analysis": "A critical analysis of the project description. Mention the technologies used and what the candidate's claimed contribution was.",
      "pinPointedQuestion": "A highly specific, pin-pointed technical question about this project to verify their depth of knowledge. e.g., 'In your project X, you mentioned using FastAPI; what was the most complex middleware you had to write and why?'"
    }}
  ],
  "potentialInconsistencies": [
      "A potential inconsistency or vague claim found in the resume, e.g., 'Claims expertise in 'big data' but projects only show small-scale data handling.'",
      "Another point that requires clarification, e.g., 'Timeline for Project A and Project B appears to overlap.'"
  ]
}}
"""


# --- Helper Function for PDF Parsing ---
def extract_pdf_text(file_stream):
    """Extracts text from a PDF file stream."""
    try:
        pdf_reader = pypdf.PdfReader(file_stream)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text()
        return text
    except Exception as e:
        # This will be caught by the endpoint's try/except block
        raise ValueError(f"Error reading PDF: {e}")


# --- Authentication Dependency ---
# This function will be run before any protected endpoint.
# It checks the "Authorization: Bearer <token>" header.
token_auth_scheme = HTTPBearer()

def get_current_user(cred: HTTPAuthorizationCredentials = Depends(token_auth_scheme)):
    """
    A dependency that verifies the Firebase ID token from the Authorization header
    and returns the user's info. If the token is invalid, it raises an HTTP 401
    Unauthorized error, and the endpoint code will not be executed.
    """
    if not cred:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token not provided",
        )
    try:
        # Verify the token against the Firebase project
        decoded_token = auth.verify_id_token(cred.credentials)
        return decoded_token
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication credentials: {e}",
        )


# --- API Endpoints ---

@app.get("/")
def read_root():
    """A simple public endpoint to check if the API is running."""
    return {"message": "Resume Analyzer API is running."}


@app.post("/analyze-resume/")
async def analyze_resume(
    user: dict = Depends(get_current_user), # This protects the endpoint
    file: UploadFile = File(...),
    job_description: str = Form(...)
):
    """
    Receives a resume PDF and job description, analyzes them with Gemini,
    and returns a structured JSON interview kit. Requires authentication.
    """
    print(f"Request received from authenticated user: {user['uid']}")
    if not file.content_type == "application/pdf":
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a PDF.")

    try:
        resume_text = extract_pdf_text(file.file)
        if not resume_text:
            raise HTTPException(status_code=400, detail="Could not extract text from the PDF.")

        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = prompt_initial_analysis.format(
            resume_text=resume_text,
            job_description=job_description
        )
        response = model.generate_content(prompt)

        # Clean the response and parse it as JSON
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        json_response = json.loads(cleaned_response)

        # Add the raw resume text to the response so the frontend can use it for the deep dive
        json_response["rawResumeText"] = resume_text
        
        return json_response

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse Gemini's response as JSON.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")


class DeepDiveRequest(BaseModel):
    """Defines the expected request body for the deep-dive endpoint."""
    resume_text: str


@app.post("/deep-dive-analysis/")
async def deep_dive_analysis(
    request: DeepDiveRequest,
    user: dict = Depends(get_current_user) # This protects the endpoint
):
    """
    Receives raw resume text and performs a deep-dive analysis using Gemini.
    Requires authentication.
    """
    print(f"Deep dive request received from authenticated user: {user['uid']}")
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = prompt_deep_dive.format(resume_text=request.resume_text)
        response = model.generate_content(prompt)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        json_response = json.loads(cleaned_response)
        return json_response
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse deep dive response from Gemini as JSON.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred during deep dive: {e}")

