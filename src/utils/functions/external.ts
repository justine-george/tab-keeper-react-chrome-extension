// Lite build - see the note in src/config/firebase.ts. Must match the import
// there, since db is created by that module's getFirestore.
import { deleteDoc, doc, setDoc } from 'firebase/firestore/lite';
import {
  cloudUnavailable,
  db,
  fetchDataFromFirestore,
  CloudCandidate,
  ensureCloudSessionReady,
} from '../../config/firebase';
import { showToast } from '../../redux/slices/globalStateSlice';
import { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { AppDispatch } from '../../redux/store';
import { stripEmbeddedFavicons } from './local';
import { isMissingDocumentError } from './firestoreErrors';

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
  userId: string
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
    // "No document for this user yet" -- the one failure that means the cloud
    // is empty. The recovery, seeding it from local state, is the CALLER's:
    // syncStateWithFirestore's local-only branch does exactly that on
    // undefined. This used to dispatch the seeding write here as well, so a
    // fresh device wrote the same document twice, and its setIsDirty
    // scheduled the middleware's debounced full sync on top (KAN-264).
    if (isMissingDocumentError(error, userId)) {
      console.warn('handled error: ' + error.message);
      return undefined;
    }
    // Every other failure is a read that FAILED, not a document that is
    // absent, and the two must not look the same to the caller. Returning
    // undefined sent the sync down its local-only branch, which marks local
    // dirty and writes it over a cloud document that was never read. Throw
    // instead: syncStateWithFirestore's rejected case (KAN-263) turns it
    // into sync_problem, and the next sync reads first.
    //
    // permission-denied is in this set (KAN-266). It used to be the second
    // "empty cloud" case, from when a manual sync could read before sign-in
    // landed; the starters now wait and the boot path is gated, so a denied
    // read means "not authorised", and the one thing that must not follow is
    // a write that, by then, IS authorised.
    console.warn('unexpected error: ' + error.message);
    throw error;
  }
}

// Which client shape last wrote this document.
//
// 1 is implied by absence: every version shipped before KAN-6 phase 1. 2 means
// "this writer can also READ a compressed document", which is the only question
// phase 2 needs answered before it may compress.
//
// A BACKOFF RATCHET, not an authorisation. Seeing 1 proves an old client is
// still active on the account and phase 2 must not compress. Seeing 2 proves
// nothing about a second device that has simply not written lately - and an old
// client crashes in the merge before it can write, so it cannot self-report.
// Only Web Store adoption data can authorise the flip.
export const CURRENT_WRITER_VERSION = 2;

// save data to Firestore
export async function saveToFirestore(
  userId: string,
  data: TabMasterContainer
): Promise<void> {
  // KAN-147. Thrown, not silently skipped: the caller keeps isDirty set and the
  // header reports the real state. Returning quietly here would claim a write
  // that never happened -- the exact failure the catch below exists to prevent.
  if (db === null) throw cloudUnavailable();

  try {
    await setDoc(doc(db, 'tabGroupData', userId), {
      ...stripEmbeddedFavicons(data),
      writerVersion: CURRENT_WRITER_VERSION,
    });
  } catch (error: any) {
    // Rethrow so the caller leaves isDirty set and the sync indicator shows the
    // real state. Swallowing here reported success while nothing was written.
    console.warn('Error updating Firestore: ', error.message);
    throw error;
  }
}

// KAN-254. Removes the user's document. Thrown, not swallowed: the caller
// tells the user it failed, and a silent failure here would report a delete
// that never happened -- the one outcome worse than an error.
export async function deleteFromFirestore(userId: string): Promise<void> {
  if (db === null) throw cloudUnavailable();
  await deleteDoc(doc(db, 'tabGroupData', userId));
}

// KAN-259. Re-exported so the slice reaches Firebase only through this
// module, which is what its tests mock.
export { ensureCloudSessionReady };
