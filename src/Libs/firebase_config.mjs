// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getMessaging, isSupported } from "firebase/messaging";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAe_nLTU6TJStVUJk68qqX9SKEL-cVXe0k",
  authDomain: "pryton-leather.firebaseapp.com",
  projectId: "pryton-leather",
  storageBucket: "pryton-leather.firebasestorage.app",
  messagingSenderId: "299522640885",
  appId: "1:299522640885:web:5005c1f0c5cdae79a1aebc",
  measurementId: "G-XNHZX26JLD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Storage and get a reference to the service
const storage = getStorage(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Initialize Firebase Cloud Messaging only if the browser supports it
let messaging = null;
isSupported()
  .then((supported) => {
    if (supported) {
      messaging = getMessaging(app);
    } else {
      console.warn("Firebase Messaging is not supported in this browser/context.");
    }
  })
  .catch((err) => {
    console.warn("Error checking Firebase Messaging support:", err);
  });

export { app, storage, db, auth, messaging };