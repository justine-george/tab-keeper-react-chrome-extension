import { initializeApp } from 'firebase/app';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';

import { AppDispatch } from '../redux/store';
import { setLoggedOut, setSignedIn } from '../redux/slice/globalStateSlice';
import { TabMasterContainer } from '../redux/slice/tabContainerDataStateSlice';
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

export { auth, db };

export const observeAuthState = (dispatch: AppDispatch) => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // User is signed in
      dispatch(setSignedIn());
    } else {
      // User is signed out, anonymous sign them back in
      dispatch(setLoggedOut());
      signInUserAnonymously();
    }
  });
};

export const signInUserAnonymously = () => {
  return signInAnonymously(auth)
    .then((userCredential) => {
      // Signed in successfully
      const user = userCredential.user;
      return user.uid;
    })
    .catch((error) => {
      const errorCode = error.code;
      const errorMessage = error.message;
      console.error(`Error (${errorCode}): ${errorMessage}`);
    });
};

export const fetchDataFromFirestore = async (
  userId: string
): Promise<TabMasterContainer> => {
  // Fetch your data based on the signed-in user's ID
  const tabData = await getDoc(doc(db, 'tabGroupData', userId));
  if (!tabData.exists()) {
    console.warn('No document found for userId: ' + userId);
    throw new Error('Document does not exist for userId: ' + userId);
  } else {
    return {
      lastModified: tabData.data().lastModified,
      tabGroups: tabData.data().tabGroups,
      selectedTabGroupId: tabData.data().selectedTabGroupId,
    };
  }
};
