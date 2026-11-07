// KAN-460 Part 4. Worker-safe: chrome types only.

// chrome.tabs.SPLIT_VIEW_ID_NONE: a tab in no split.
export const SPLIT_VIEW_ID_NONE = -1;

// chrome.tabs.createSplit, Chrome 155+, missing from @types/chrome. Measured: two adjacent tabs, same pinned and group; resolves to the split's id.
export type CreateSplit = (tabIds: number[]) => Promise<number>;

const isCreateSplit = (found: unknown): found is CreateSplit =>
  typeof found === 'function';

// Null before Chrome 155, where a saved split opens as two ordinary tabs (D3).
export function createSplitApi(): CreateSplit | null {
  const found: unknown = Reflect.get(chrome.tabs, 'createSplit');
  return isCreateSplit(found) ? found.bind(chrome.tabs) : null;
}

// chrome.tabs.unsplit, missing from @types/chrome. Measured on Chromium 156: ends a split in place, order, pin, group and the front tab kept; refuses an id no split has.
export type Unsplit = (splitViewId: number) => Promise<void>;

const isUnsplit = (found: unknown): found is Unsplit =>
  typeof found === 'function';

// Null where Chrome has none: Open now then offers no End split view.
export function unsplitApi(): Unsplit | null {
  const found: unknown = Reflect.get(chrome.tabs, 'unsplit');
  return isUnsplit(found) ? found.bind(chrome.tabs) : null;
}
