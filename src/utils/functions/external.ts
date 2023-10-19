import { doc, setDoc } from 'firebase/firestore';
import { db, fetchDataFromFirestore } from '../../config/firebase';
import {
  saveToFirestoreIfDirty,
  setIsDirty,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { AppDispatch } from '../../redux/store';

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
): Promise<TabMasterContainer | undefined> {
  try {
    const tabDataFromCloud: TabMasterContainer =
      await fetchDataFromFirestore(userId);
    return tabDataFromCloud;
  } catch (error: any) {
    if (error.message === 'Document does not exist for userId: ' + userId) {
      console.warn('handled error: ' + error.message);
      thunkAPI.dispatch(setIsDirty());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
    } else if (error.message === `Missing or insufficient permissions.`) {
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
    await setDoc(doc(db, 'tabGroupData', userId), data);
  } catch (error: any) {
    console.warn('Error updating Firestore: ', error.message);
  }
}
