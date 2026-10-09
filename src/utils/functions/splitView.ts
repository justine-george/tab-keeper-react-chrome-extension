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
