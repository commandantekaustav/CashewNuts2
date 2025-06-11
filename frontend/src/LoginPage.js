// frontend/src/LoginPage.js
import React, { useState } from 'react';
import { auth } from './firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

// We'll reuse some styles from App.css but add a few specific ones
const loginPageStyles = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  backgroundColor: '#f0f2f5'
};

const formStyles = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '2rem',
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  width: '350px'
};

const inputStyles = {
  padding: '12px',
  fontSize: '1rem',
  border: '1px solid #ccc',
  borderRadius: '4px'
};

const buttonStyles = {
  padding: '12px',
  fontSize: '1rem',
  cursor: 'pointer',
  border: 'none',
  borderRadius: '4px',
  color: 'white'
};


function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleSignIn = (e) => {
    e.preventDefault();
    setError(null);
    signInWithEmailAndPassword(auth, email, password)
      .catch((err) => setError(err.message));
  };

  const handleSignUp = (e) => {
    e.preventDefault();
    setError(null);
    createUserWithEmailAndPassword(auth, email, password)
      .catch((err) => setError(err.message));
  };

  return (
    <div style={loginPageStyles}>
      <form style={formStyles}>
        <h2>Recruitment Assistant Login</h2>
        <input
          style={inputStyles}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          style={inputStyles}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button
          style={{...buttonStyles, backgroundColor: '#0d6efd'}}
          onClick={handleSignIn}>
          Sign In
        </button>
        <button
          style={{...buttonStyles, backgroundColor: '#6c757d'}}
          onClick={handleSignUp}>
          Sign Up
        </button>
        {error && <p style={{color: 'red', textAlign: 'center'}}>{error}</p>}
      </form>
    </div>
  );
}

export default LoginPage;