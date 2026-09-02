// Lite build - see the note in src/config/firebase.ts. Must match the import
// there, since db is created by that module's getFirestore.
import { doc, setDoc } from 'firebase/firestore/lite';
import {
  db,
  fetchDataFromFirestore,
  CloudCandidate,
} from '../../config/firebase';
import {
  saveToFirestoreIfDirty,
  setIsDirty,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { AppDispatch } from '../../redux/store';
import { stripEmbeddedFavicons } from './local';
import { isMissingDocumentError, isPermissionDenied } from './firestoreErrors';

// display a toast message
export const displayToast = (
  dispatch: AppDispatch,
  text: string,
  duration?: number,
  error?: any
) => {
  const displayText = error ? error.message || 'An error occurred.' : text;
  dispatch(
    showToast({
      toastText: displayText,
      duration: duration || 3000,
    })
  );
};

// load data from Firestore
export async function loadFromFirestore(
  userId: string,
  thunkAPI: any
): Promise<CloudCandidate | undefined> {
  try {
    const tabDataFromCloud: CloudCandidate =
      await fetchDataFromFirestore(userId);
    // Deliberately not stripped on read. Documents written before the write-side
    // strip still carry embedded favicons, and those render fine locally - a
    // document is capped at 1 MiB while localStorage holds far more, so there is
    // nothing to gain by discarding them, and doing so would blank icons that
    // still work.
    return tabDataFromCloud;
  } catch (error: any) {
    // Both of these mean "no usable cloud document for this user yet": either
    // none exists, or the rules rejected the read because anonymous sign-in
    // has not landed. Either way the recovery is the same - seed the document
    // from local state.
    //
    // Match the permission failure on error.code, not on the message. The lite
    // build reports it as "Request failed with error: Missing or insufficient
    // permissions.", so comparing against the bare message silently fell
    // through to the unexpected branch and skipped the retry entirely.
    if (isMissingDocumentError(error, userId) || isPermissionDenied(error)) {
      console.warn('handled error: ' + error.message);
      thunkAPI.dispatch(setIsDirty());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
    } else {
      // Handle other types of Firestore errors
      console.warn('unexpected error: ' + error.message);
    }
  }
}

// save data to Firestore
export async function saveToFirestore(
  userId: string,
  data: TabMasterContainer
): Promise<void> {
  try {
    await setDoc(doc(db, 'tabGroupData', userId), stripEmbeddedFavicons(data));
  } catch (error: any) {
    // Rethrow so the caller leaves isDirty set and the sync indicator shows the
    // real state. Swallowing here reported success while nothing was written.
    console.warn('Error updating Firestore: ', error.message);
    throw error;
  }
}
