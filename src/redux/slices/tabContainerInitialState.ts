import type { TabMasterContainer } from './tabContainerDataStateSlice';

// The session container before anything loads. A leaf on purpose (KAN-551):
// undoRedoSlice seeds `present` with it, and reading it from the session slice
// put undoRedoSlice inside the slices' import cycle, where vitest could run it
// first and seed `present` with undefined (KAN-137).
export const initialState: TabMasterContainer = {
  lastModified: Date.now(), // timestamp
  selectedTabGroupId: null,
  tabGroups: [],
};
