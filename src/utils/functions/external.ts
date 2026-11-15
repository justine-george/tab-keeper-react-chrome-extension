// Lite build - see the note in src/config/firebase.ts. Must match the import
// there, since db is created by that module's getFirestore.
import { Bytes, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore/lite';
import {
  cloudUnavailable,
  db,
  fetchDataFromFirestore,
  CloudCandidate,
  ensureCloudSessionReady,
} from '../../config/firebase';
import { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { encodeCloudDocument } from './cloudDocument';
import { isMissingDocumentError } from './firestoreErrors';

// load data from Firestore
export async function loadFromFirestore(
  userId: string
): Promise<CloudCandidate | undefined> {
  try {
    const tabDataFromCloud: CloudCandidate =
      await fetchDataFromFirestore(userId);
    // Not stripped here: replaceState strips whatever the sync loads (KAN-594),
    // and Chrome's favicon cache draws the dropped icons.
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
// "this writer can also READ a compressed document".
//
// KAN-6 phase 2 compresses past 80% (cloudDocument.ts) while a pre-1.5.0 tail
// remains: about 27 daily users, flat since mid-October (store CSV to
// 2026-11-13). Below the line nothing changes for them; above it their sync
// was about to stop anyway. A 1.3.x write throws before setDoc on a document
// without tabGroups, so an old device cannot write an empty copy back.
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
    // KAN-600 and KAN-6. The example stays here; big accounts go as gzip Bytes.
    const encoded = await encodeCloudDocument(data);
    const fields = encoded.compressed
      ? {
          ...encoded.fields,
          tabGroupsZ: Bytes.fromUint8Array(encoded.fields.tabGroupsZ),
        }
      : encoded.fields;
    await setDoc(doc(db, 'tabGroupData', userId), {
      ...fields,
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

// KAN-719. Whether the user's document exists. A failed read rejects: "could not look" is never "nothing there".
export async function cloudDocumentExists(userId: string): Promise<boolean> {
  if (db === null) throw cloudUnavailable();
  const snapshot = await getDoc(doc(db, 'tabGroupData', userId));
  return snapshot.exists();
}

// KAN-259. Re-exported so the slice reaches Firebase only through this
// module, which is what its tests mock.
export { ensureCloudSessionReady };
