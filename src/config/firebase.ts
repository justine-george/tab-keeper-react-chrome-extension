import { initializeApp } from 'firebase/app';
// The lite build, not the full SDK. Sync is a single getDoc on open and a
// single setDoc on save - no realtime listeners, and offline persistence was
// never enabled here. The full SDK's cache and write queue only pay off on
// long-lived pages, and a popup is destroyed before either is used twice.
// Switching costs ~106 kB gzipped. Moving back to 'firebase/firestore' means
// paying that again, so only do it if onSnapshot or offline reads are needed.
import { doc, getDoc, getFirestore } from 'firebase/firestore/lite';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';

import { AppDispatch } from '../redux/store';
import { setLoggedOut, setSignedIn } from '../redux/slices/globalStateSlice';
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
      console.warn(`Error (${errorCode}): ${errorMessage}`);
    });
};

// What a document decodes to before anything has proven its shape.
//
// This read used to declare Promise<TabMasterContainer> while assigning
// unproven DocumentData fields into it, which is a claim it cannot support:
// the document is user-syncable data that another client version may have
// written. Saying `unknown` here forces the single narrowing to happen at
// isValidTabMasterContainer in syncStateWithFirestore, where it belongs.
export interface CloudCandidate {
  lastModified: unknown;
  tabGroups: unknown;
  selectedTabGroupId: unknown;
  deletedTabGroups: unknown;
}

export const fetchDataFromFirestore = async (
  userId: string
): Promise<CloudCandidate> => {
  try {
    // Fetch your data based on the signed-in user's ID
    const tabData = await getDoc(doc(db, 'tabGroupData', userId));

    if (!tabData.exists()) {
      console.warn('No document found for userId: ' + userId);
      throw new Error('Document does not exist for userId: ' + userId);
    } else {
      // Field-by-field rather than returning data() wholesale, so the shape is
      // explicit. That makes this a whitelist: any field added to the
      // persisted container must be added here too, or it is written to
      // Firestore and then silently dropped on the way back in.
      //
      // deletedTabGroups was exactly that. Tombstones reached the document but
      // never came back, so every merge saw a cloud with no record of the
      // delete, recomputed changedFromCloud as true, wrote again, and looped -
      // and the deletion never propagated to the other device.
      const data = tabData.data();
      return {
        lastModified: data.lastModified,
        tabGroups: data.tabGroups,
        selectedTabGroupId: data.selectedTabGroupId,
        deletedTabGroups: data.deletedTabGroups,
      };
    }
  } catch (error) {
    console.warn('fetchDataFromFirestore: Error fetching data:', error);
    throw error;
  }
};
