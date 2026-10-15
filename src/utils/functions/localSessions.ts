import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import {
  isStoredBehindPage,
  isValidTabMasterContainer,
  loadFromLocalStorage,
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
