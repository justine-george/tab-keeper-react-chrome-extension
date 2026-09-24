import type { Global } from './slices/globalStateSlice';
import type { SettingsData } from './slices/settingsDataStateSlice';

// The two fields the answer reads. RootState satisfies it, so useSelector
// takes the selector as is.
export interface SavedSessionFoldState {
  settingsDataState: Pick<SettingsData, 'foldSavedSessionInTabView'>;
  globalState: Pick<Global, 'isPeekingSavedSession'>;
}

// KAN-280 O4/O5. Whether the tab view has the saved session folded away right
// now: the stored choice, unless a saved session was clicked since (a peek).
// The grid is laid out by it and a session click peeks by it, so the two read
// one answer and cannot disagree.
export const selectIsSavedSessionFolded = (
  state: SavedSessionFoldState
): boolean =>
  state.settingsDataState.foldSavedSessionInTabView &&
  !state.globalState.isPeekingSavedSession;
