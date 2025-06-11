// frontend/src/App.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
// Import auth from your firebase.js configuration file and the LoginPage component
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from "firebase/auth";
import LoginPage from './LoginPage';

// The URL of your running backend API.
// For local development, it's http://127.0.0.1:8000
// For deployment, you will change this in Render's environment variables.
const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';

// Helper component to display difficulty level with colors
const DifficultyMarker = ({ level }) => {
  const colors = {
    1: '#28a745', // Green
    2: '#17a2b8', // Teal
    3: '#ffc107', // Yellow (text should be dark)
    4: '#fd7e14', // Orange
    5: '#dc3545', // Red
  };
  const textColor = level === 3 ? '#212529' : 'white';
  return (
    <div
      className="difficulty-marker"
      style={{ backgroundColor: colors[level] || '#6c757d', color: textColor }}
    >
      Difficulty: {level}/5
    </div>
  );
};

// Helper function to find and highlight keywords in a block of text
const renderWithHighlights = (text, keywords) => {
    if (!keywords || keywords.length === 0 || !text) {
      return text;
    }
    // Escape special regex characters from keywords
    const escapedKeywords = keywords.map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const regex = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');
    const parts = text.split(regex);
    return (
      <span>
        {parts.map((part, i) =>
          regex.test(part) ? <mark key={i}>{part}</mark> : part
        )}
      </span>
    );
};


function App() {
  // State for authentication
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // State for the main form
  const [selectedFile, setSelectedFile] = useState(null);
  const [jobDescription, setJobDescription] = useState('');
  
  // State for the initial analysis
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // State for the deep dive analysis
  const [deepDiveResult, setDeepDiveResult] = useState(null);
  const [isDeepDiveLoading, setIsDeepDiveLoading] = useState(false);
  const [deepDiveError, setDeepDiveError] = useState(null);
  
  // Effect hook to listen for changes in Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    // Cleanup subscription on component unmount
    return unsubscribe;
  }, []);

  // Helper function to get the current user's ID token for secure API calls
  const getAuthHeaders = async (isMultipart = false) => {
    if (!currentUser) {
        throw new Error("User is not authenticated.");
    }
    const token = await currentUser.getIdToken();
    const headers = {
        Authorization: `Bearer ${token}`,
    };
    if (isMultipart) {
        headers['Content-Type'] = 'multipart/form-data';
    }
    return { headers };
  }

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
    // Reset all results when a new file is chosen
    setAnalysisResult(null);
    setDeepDiveResult(null);
    setError(null);
    setDeepDiveError(null);
  };

  // Handler for the main "Initial Analysis" form submission
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedFile) {
      setError('Please select a PDF file first.');
      return;
    }
    if (!jobDescription) {
      setError('Please enter a job role or description.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);
    setDeepDiveResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('job_description', jobDescription);

    try {
      const config = await getAuthHeaders(true); // Get headers for multipart/form-data
      const response = await axios.post(`${API_URL}/analyze-resume/`, formData, config);
      setAnalysisResult(response.data);
    } catch (err) {
      const errorMessage = err.response?.data?.detail || err.message || 'An unknown error occurred.';
      setError(`Failed to analyze resume: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler for the "Deep Dive Analysis" button
  const handleDeepDive = async () => {
    if (!analysisResult?.rawResumeText) {
      setDeepDiveError("Cannot run deep dive without a successful initial analysis.");
      return;
    }
    setIsDeepDiveLoading(true);
    setDeepDiveError(null);
    setDeepDiveResult(null);
    try {
      const config = await getAuthHeaders(); // Get standard JSON headers
      const response = await axios.post(`${API_URL}/deep-dive-analysis/`, {
        resume_text: analysisResult.rawResumeText,
      }, config);
      setDeepDiveResult(response.data);
    } catch (err) {
      const errorMessage = err.response?.data?.detail || err.message || 'An unknown error occurred.';
      setDeepDiveError(`Failed to run deep dive: ${errorMessage}`);
    } finally {
      setIsDeepDiveLoading(false);
    }
  };

  const handleSignOut = () => {
    signOut(auth).catch((err) => console.error("Sign out error", err));
  };
  
  // While Firebase is checking the user's login status, show a loading spinner
  if (authLoading) {
    return <div className="spinner-container"><div className="spinner"></div></div>;
  }
  
  // If no user is logged in, render the LoginPage component
  if (!currentUser) {
    return <LoginPage />;
  }

  // If a user is logged in, render the main application
  return (
    <div className="App">
      <header>
        <h1>AI Recruitment Assistant</h1>
        <div className="user-info">
          <span>Signed in as: {currentUser.email}</span>
          <button onClick={handleSignOut} className="sign-out-btn">Sign Out</button>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="upload-section">
        <div className="form-group">
            <label htmlFor="job-description">Job Role / Description</label>
            <textarea
                id="job-description"
                rows="4"
                placeholder="e.g., Senior Python Developer with experience in FastAPI, AWS, and PostgreSQL..."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
            />
        </div>
        <div className="form-group">
            <label htmlFor="resume-upload">Candidate's Resume (PDF)</label>
            <input id="resume-upload" type="file" accept="application/pdf" onChange={handleFileChange} />
        </div>
        <button type="submit" className="upload-btn" disabled={!selectedFile || !jobDescription || isLoading}>
          {isLoading ? 'Analyzing...' : 'Run Initial Analysis'}
        </button>
      </form>

      {isLoading && <div className="spinner-container"><div className="spinner"></div></div>}
      {error && <div className="error-message">{error}</div>}

      {analysisResult && (
        <div className="results-section">
          <h2>Analysis for: {analysisResult.candidateName}</h2>
          
          <div className="card">
            <h3>Alignment Summary</h3>
            <p>{analysisResult.alignmentSummary.summaryText}</p>
            <p className="section-title">Strengths:</p>
            <ul>{analysisResult.alignmentSummary.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <p className="section-title">Potential Gaps:</p>
            <ul>{analysisResult.alignmentSummary.potentialGaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
          </div>

          <div className="card">
            <h3>Interview Questions</h3>
            {Object.entries(analysisResult.categorizedQuestions).map(([category, questions]) => (
                <div key={category}>
                    <h4>{category}</h4>
                    {questions.map((item, index) => (
                        <div key={index} className="question-card">
                            <div className="question-header">
                                <p><strong>Q: {item.question}</strong></p>
                                <DifficultyMarker level={item.difficulty} />
                            </div>
                            <div className="question-details">
                                <p className="section-title">Expected Answer:</p>
                                <p>{renderWithHighlights(item.expectedAnswer, item.keywords)}</p>
                                <p className="section-title">Non-Technical Explanation:</p>
                                <p>{item.nonTechnicalExplanation}</p>
                            </div>
                        </div>
                    ))}
                </div>
            ))}
          </div>
          
          <div className="deep-dive-section">
              <h3>Deeper Analysis</h3>
              <p>Scrutinize project experience and look for inconsistencies.</p>
              <button onClick={handleDeepDive} className="deep-dive-btn" disabled={isDeepDiveLoading}>
                  {isDeepDiveLoading ? 'Running Deep Dive...' : 'Run Deep Dive Analysis'}
              </button>
              {isDeepDiveLoading && <div className="spinner-container"><div className="spinner"></div></div>}
              {deepDiveError && <div className="error-message">{deepDiveError}</div>}
              {deepDiveResult && (
                  <div className="card">
                      <h4>Project Scrutiny</h4>
                      {deepDiveResult.projectAnalyses.map((proj, i) =>(
                          <div key={i} className="question-card">
                              <p className="section-title">Project: {proj.projectName}</p>
                              <p><strong>Analysis:</strong> {proj.analysis}</p>
                              <p><strong>Pin-pointed Question:</strong> {proj.pinPointedQuestion}</p>
                          </div>
                      ))}
                      <h4>Potential Inconsistencies</h4>
                       <ul>{deepDiveResult.potentialInconsistencies.map((inc, i) => <li key={i}>{inc}</li>)}</ul>
                  </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
