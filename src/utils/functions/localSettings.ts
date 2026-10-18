import type { SettingsData } from '../../redux/slices/settingsDataStateSlice';
import { saveJsonToLocalStorage } from './local';
import { sameIgnoringKeyOrder } from './sameContainerData';

// KAN-661. The settings half of KAN-666: every settings save writes the whole
// object, and Chrome does not always fire the storage event for another
// page's write, so a page that never heard one put the old values back.

// Storage as this page last saw it, and this page's settings at that moment:
// a field still equal to its value here is one this page has not changed
// since. `json` is null after a merged write, which holds what the page has
// not taken in yet: until it has, every save merges again.
let seen: { json: string | null; settings: Record<string, unknown> } | null =
  null;
let otherPageSettingsMerged = false;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;

const readStored = (): string | null => {
  try {
    return localStorage.getItem('settingsData');
  } catch {
    return null;
  }
};

// The page's settings now agree with storage as it stands: at load, and at every take-in.
export function noteStoredSettingsSeen(page: SettingsData): void {
  seen = {
    json: readStored(),
    settings: asRecord(JSON.parse(JSON.stringify(page))) ?? {},
  };
}

// Whether a save since the last call merged in another page's write; clears the note.
export const takeOtherPageSettingsMerged = (): boolean => {
  const noted = otherPageSettingsMerged;
  otherPageSettingsMerged = false;
  return noted;
};

/**
 * Every save of this page's settings. When storage changed since this page
 * last saw it, each field this page has not changed since is taken from
 * storage rather than written over; the note has the middleware take them in
 * on screen. Otherwise, or when storage is unreadable, the page is written as
 * it is.
 */
export function saveLocalSettings(page: SettingsData): void {
  const own = JSON.stringify(page);
  const toStore = withOtherPageSettings(own);
  if (!saveJsonToLocalStorage('settingsData', toStore)) return;
  seen = {
    json: toStore === own ? own : null,
    settings: asRecord(JSON.parse(own)) ?? {},
  };
}

function withOtherPageSettings(own: string): string {
  if (seen === null) return own;
  const stored = readStored();
  if (stored === null || stored === seen.json) return own;
  let parsed: Record<string, unknown> | null;
  try {
    parsed = asRecord(JSON.parse(stored));
  } catch {
    return own;
  }
  const page = asRecord(JSON.parse(own));
  if (parsed === null || page === null) return own;
  const other = parsed;
  const base = seen.settings;
  const merged = Object.fromEntries(
    Object.entries(page).map(([key, value]) => [
      key,
      key in other && sameIgnoringKeyOrder(value, base[key])
        ? other[key]
        : value,
    ])
  );
  if (sameIgnoringKeyOrder(merged, page)) return own;
  otherPageSettingsMerged = true;
  return JSON.stringify(merged);
}
