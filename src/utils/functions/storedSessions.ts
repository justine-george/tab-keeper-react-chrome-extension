import { isValidTabMasterContainer, loadFromLocalStorage } from './local';

// Saved sessions on disk now; at mount the store has not loaded them yet.
export function storedSessionCount(): number {
  const stored = loadFromLocalStorage('tabContainerData');
  return isValidTabMasterContainer(stored) ? stored.tabGroups.length : 0;
}
