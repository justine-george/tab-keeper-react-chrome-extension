import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { GoogleAuthProvider, getAuth, onAuthStateChanged } from "firebase/auth";
import { setLoggedOut, setSignedIn } from "../redux/slice/globalStateSlice";
import { AppDispatch } from "../redux/store";
// https://firebase.google.com/docs/web/setup#available-libraries

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider, db };

export const observeAuthState = (dispatch: AppDispatch) => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // User is signed in
      console.log(user.uid + " signed in!");
      dispatch(setSignedIn());
    } else {
      // User is signed out
      console.log("Signed out!");
      dispatch(setLoggedOut());
    }
  });
};
