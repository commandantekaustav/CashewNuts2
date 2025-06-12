// frontend/src/App.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './App.css';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from "firebase/auth";
import LoginPage from './LoginPage';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';

const DifficultyMarker = ({ level }) => {
    const colors = { 1: '#28a745', 2: '#17a2b8', 3: '#ffc107', 4: '#fd7e14', 5: '#dc3545' };
    const textColor = level === 3 ? '#212529' : 'white';
    return (
        <div className="difficulty-marker" style={{ backgroundColor: colors[level] || '#6c757d', color: textColor }}>
            Difficulty: {level}/5
        </div>
    );
};

const renderWithHighlights = (text, keywords) => {
    if (!keywords || keywords.length === 0 || !text) return text;
    const escapedKeywords = keywords.map(k => k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const regex = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');
    const parts = text.split(regex);
    return (
        <span>
            {parts.map((part, i) => regex.test(part) ? <mark key={i}>{part}</mark> : part)}
        </span>
    );
};

function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [selectedFile, setSelectedFile] = useState(null);
    const [jobDescription, setJobDescription] = useState('');
    const [difficulty, setDifficulty] = useState(3);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [projectQuestions, setProjectQuestions] = useState(null);
    const [isProjectLoading, setIsProjectLoading] = useState(false);
    const [projectError, setProjectError] = useState(null);
    const [selectedProject, setSelectedProject] = useState('');
    const [isRegenerating, setIsRegenerating] = useState(false);
    const debounceTimeout = useRef(null);
    const initialAnalysisCompleted = useRef(false);

    const getAuthHeaders = useCallback(async (isMultipart = false) => {
        if (!currentUser) throw new Error("User not authenticated.");
        const token = await currentUser.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };
        if (isMultipart) headers['Content-Type'] = 'multipart/form-data';
        return { headers };
    }, [currentUser]);

    useEffect(() => {
        if (!initialAnalysisCompleted.current) {
            return;
        }
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }
        setIsRegenerating(true);
        debounceTimeout.current = setTimeout(async () => {
            try {
                const config = await getAuthHeaders();
                const response = await axios.post(`${API_URL}/regenerate-questions/`, {
                    resume_text: analysisResult.rawResumeText,
                    job_description: analysisResult.jobDescription,
                    difficulty: difficulty
                }, config);
                setAnalysisResult(prevResult => ({
                    ...prevResult,
                    categorizedQuestions: response.data.categorizedQuestions
                }));
            } catch (err) {
                console.error("Failed to regenerate questions:", err);
            } finally {
                setIsRegenerating(false);
            }
        }, 500);
    }, [difficulty, getAuthHeaders]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, user => {
            setCurrentUser(user);
            setAuthLoading(false);
        });
        return unsubscribe;
    }, []);

    const handleFileChange = (e) => {
        setSelectedFile(e.target.files[0]);
        setAnalysisResult(null);
        setProjectQuestions(null);
        initialAnalysisCompleted.current = false;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!selectedFile || !jobDescription) {
            setError('Please select a file and enter a job description.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setAnalysisResult(null);
        setProjectQuestions(null);
        setProjectError(null);
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('job_description', jobDescription);
        formData.append('difficulty', difficulty);
        try {
            const config = await getAuthHeaders(true);
            const response = await axios.post(`${API_URL}/analyze-resume/`, formData, config);
            setAnalysisResult(response.data);
            initialAnalysisCompleted.current = true;
        } catch (err) {
            setError(`Failed to analyze resume: ${err.response?.data?.detail || err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleProjectDrilldown = async (projectName) => {
        if (!analysisResult?.rawResumeText) { return; }
        setSelectedProject(projectName);
        setIsProjectLoading(true);
        setProjectError(null);
        setProjectQuestions(null);
        try {
            const config = await getAuthHeaders();
            const response = await axios.post(`${API_URL}/project-questions/`, {
                resume_text: analysisResult.rawResumeText,
                project_name: projectName
            }, config);
            setProjectQuestions(response.data.projectQuestions);
        } catch (err) {
            setProjectError(`Failed to get project questions: ${err.response?.data?.detail || err.message}`);
        } finally {
            setIsProjectLoading(false);
        }
    };
    
    const handleSignOut = () => signOut(auth);

    if (authLoading) return <div className="spinner-container"><div className="spinner"></div></div>;
    if (!currentUser) return <LoginPage />;

    return (
        <div className="App">
            <header>
                <h1>AI Recruitment Assistant</h1>
                <div className="user-info">
                    <span>{currentUser.email}</span>
                    <button onClick={handleSignOut} className="sign-out-btn">Sign Out</button>
                </div>
            </header>
            <form onSubmit={handleSubmit} className="upload-section">
                <div className="form-group">
                    <label htmlFor="job-description">Job Role / Description</label>
                    <textarea id="job-description" rows="4" placeholder="e.g., Senior Python Developer..." value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
                </div>
                <div className="form-group">
                    <label htmlFor="resume-upload">Candidate's Resume (PDF)</label>
                    <input id="resume-upload" type="file" accept="application/pdf" onChange={handleFileChange} />
                </div>
                <div className="form-group difficulty-slider">
                    <label htmlFor="difficulty">Question Difficulty: {difficulty}</label>
                    <span>Easy</span>
                    <input type="range" id="difficulty" min="1" max="5" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
                    <span>Expert</span>
                </div>
                <button type="submit" className="upload-btn" disabled={!selectedFile || !jobDescription || isLoading}>
                    {isLoading ? 'Analyzing...' : 'Run Analysis'}
                </button>
            </form>

            {isLoading && <div className="spinner-container"><div className="spinner"></div></div>}
            {error && <div className="error-message">{error}</div>}

            {analysisResult && (
                <div className="results-section">
                    <h2>Analysis for: {analysisResult.candidateName}</h2>
                    <div className="card confidence-card">
                        <h3>Confidence Score: {analysisResult.confidenceScore.score}/100</h3>
                        <p><strong>Justification:</strong> {analysisResult.confidenceScore.justification}</p>
                    </div>

                    <div className="card inconsistency-card">
                        <h3 className="inconsistency-title">Potential Red Flags & Verification</h3>
                        <p className="section-title">Verified Employment Gaps & Overlaps (Logic-Based):</p>
                        {analysisResult.dateAnalysis?.gaps?.length > 0 && (
                            <ul>
                                {analysisResult.dateAnalysis.gaps.map((gap, i) => <li key={i} className="gap-item">{gap}</li>)}
                            </ul>
                        )}
                        {analysisResult.dateAnalysis?.overlaps?.length > 0 && (
                            <ul>
                                {analysisResult.dateAnalysis.overlaps.map((overlap, i) => <li key={i} className="overlap-item">{overlap}</li>)}
                            </ul>
                        )}
                        {(analysisResult.dateAnalysis?.gaps?.length === 0 && analysisResult.dateAnalysis?.overlaps?.length === 0) && (
                            <p>No significant employment gaps or overlaps found.</p>
                        )}

                        <p className="section-title">AI-Suggested Inconsistencies (Non-Date Related):</p>
                        {analysisResult.potentialInconsistencies?.length > 0 ? (
                             <ul>
                                {analysisResult.potentialInconsistencies.map((inc, i) => <li key={i}>{inc}</li>)}
                             </ul>
                        ) : (
                            <p>No major non-date inconsistencies were flagged by the AI.</p>
                        )}
                    </div>

                    <div className="card question-card-container">
                        {isRegenerating && <div className="card-overlay"><div className="spinner"></div></div>}
                        <h3>Interview Questions</h3>
                        {analysisResult.categorizedQuestions && Object.entries(analysisResult.categorizedQuestions).map(([category, questions]) => (
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

                    <div className="card project-drilldown-card">
                        <h3>Project Specific Questions</h3>
                        <p>Select a project to generate highly specific follow-up questions.</p>
                        <div className="project-buttons">
                            {analysisResult.projectNames?.map(name => (
                                <button key={name} className="project-btn" onClick={() => handleProjectDrilldown(name)} disabled={isProjectLoading}>
                                    {name}
                                </button>
                            ))}
                        </div>
                        {isProjectLoading && <div className="spinner-container"><div className="spinner"></div></div>}
                        {projectError && <div className="error-message">{projectError}</div>}
                        {projectQuestions && (
                            <div className="project-questions-result">
                                <h4>Questions for "{selectedProject}"</h4>
                                {projectQuestions.map((item, index) => (
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
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
