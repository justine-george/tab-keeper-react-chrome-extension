import type { SettingsData } from './slices/settingsDataStateSlice';
import { sameIgnoringKeyOrder } from '../utils/functions/sameContainerData';

// KAN-615. Settings this page changed since its last save that landed. Another
// page writes its WHOLE settings object, which still holds the old value of
// each, so applyOtherPageSettings keeps this page's. Settings carry no
// per-field stamps; this set is what says whose a field is.
// Module state, as dragHold: storageFullMiddleware fills it, and it is not
// application data.
const unsaved = new Set<keyof SettingsData>();

const isSettingsKey = (
  settings: SettingsData,
  key: string
): key is keyof SettingsData => key in settings;

// The fields an action changed, while settingsData's saves are refused.
export function noteUnsavedSettings(
  before: SettingsData,
  after: SettingsData
): void {
  for (const key of Object.keys(after)) {
    if (
      isSettingsKey(after, key) &&
      !sameIgnoringKeyOrder(before[key], after[key])
    ) {
      unsaved.add(key);
    }
  }
}

// A save landed: storage holds every field of this page's settings.
export function clearUnsavedSettings(): void {
  unsaved.clear();
}

function keep<K extends keyof SettingsData>(
  to: SettingsData,
  from: SettingsData,
  key: K
): void {
  to[key] = from[key];
}

// `incoming` with this page's value for each field storage does not hold.
export function withUnsavedSettings(
  incoming: SettingsData,
  page: SettingsData
): SettingsData {
  const next = { ...incoming };
  for (const key of unsaved) keep(next, page, key);
  return next;
}
