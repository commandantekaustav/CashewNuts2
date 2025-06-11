// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD6GJy7M9wZO3MQ3_1_6rbZ1Y9inlZdVgM",
  authDomain: "cashewnuts2.firebaseapp.com",
  projectId: "cashewnuts2",
  storageBucket: "cashewnuts2.firebasestorage.app",
  messagingSenderId: "23524403328",
  appId: "1:23524403328:web:844241028caff498ba5e65",
  measurementId: "G-PF5TVTTT47"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and export it for use in other files
// This line creates the 'auth' object that your other files need.
export const auth = getAuth(app);
