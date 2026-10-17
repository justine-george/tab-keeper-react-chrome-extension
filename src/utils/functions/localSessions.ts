import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import {
  isStoredBehindPage,
  isValidTabMasterContainer,
  loadFromLocalStorage,
  saveJsonToLocalStorage,
} from './local';
import { mergeTabContainers } from './mergeTabData';

/**
 * KAN-593. This device's sessions, as the sync and every re-read take them:
 * localStorage, unless this page's last save failed. Then localStorage is
 * older than the page, and taking it as it is puts the older copy back on
 * screen. So the page's sessions come first, with anything another page saved
 * merged in; the page itself when storage has nothing it lacks.
 *
 * Unknown, like loadFromLocalStorage: the caller still validates. Unreadable
 * storage behind the page yields the page.
 */
export function readLocalSessions(page: TabMasterContainer): unknown {
  const stored = loadFromLocalStorage('tabContainerData');
  if (!isStoredBehindPage('tabContainerData')) return stored;
  if (!isValidTabMasterContainer(stored)) return page;
  // The page first: it keeps its selection and its example session, and the
  // merge's flag says whether storage added anything.
  const { merged, changedFromLocal } = mergeTabContainers(
    page,
    stored,
    Date.now()
  );
  return changedFromLocal ? merged : page;
}

// KAN-666. Exactly what this page last wrote. Storage holding anything else
// means another page wrote since -- and Chrome does not always fire the
// storage event that would have told this page (measured: 3 in 4,000 runs).
let lastWritten: string | null = null;
let otherPageWriteMerged = false;

// Whether a save since the last call merged in another page's write; clears the note.
export const takeOtherPageWriteMerged = (): boolean => {
  const noted = otherPageWriteMerged;
  otherPageWriteMerged = false;
  return noted;
};

/**
 * KAN-666. Every save of this page's sessions. A write another page made since
 * this page's last one is merged in, the page first as in readLocalSessions,
 * rather than written over; the note has the middleware take it in on screen.
 * Unreadable storage is written over, as before.
 */
export function saveLocalSessions(page: TabMasterContainer): void {
  const json = JSON.stringify(withOtherPageWrite(page));
  if (saveJsonToLocalStorage('tabContainerData', json)) lastWritten = json;
}

function withOtherPageWrite(page: TabMasterContainer): TabMasterContainer {
  let stored: string | null;
  try {
    stored = localStorage.getItem('tabContainerData');
  } catch {
    return page;
  }
  if (stored === null || stored === lastWritten) return page;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return page;
  }
  if (!isValidTabMasterContainer(parsed)) return page;
  const { merged, changedFromLocal } = mergeTabContainers(
    page,
    parsed,
    Date.now()
  );
  if (!changedFromLocal) return page;
  otherPageWriteMerged = true;
  return merged;
}
