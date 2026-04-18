import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDKaaYw7lThNbovr174k8CKcQQrO8hUAZg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "whiskey-atlas.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "whiskey-atlas",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "whiskey-atlas.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "235421330318",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:235421330318:web:ed802de71b19d0365c52df"
};

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

let db = null;

if (hasFirebaseConfig) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}

export { db, hasFirebaseConfig };
