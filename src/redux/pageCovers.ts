import type { RootState } from './store';

// A run here, the replay note, setup, the pin guide, the full-view callout or
// the first-save pop (KAN-875) is on the page; a card waits or hides for it.
export const hasPageCover = (state: RootState): boolean => {
  const g = state.globalState;
  return (
    g.isRunHere ||
    g.isReplayNoteOpen ||
    g.isSetupOpen ||
    g.isPinGuideOpen ||
    g.isFullViewCalloutOpen ||
    g.isFirstSavePopping
  );
};
