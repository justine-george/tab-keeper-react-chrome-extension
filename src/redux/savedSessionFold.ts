import type { Global } from './slices/globalStateSlice';
import type { SettingsData } from './slices/settingsDataStateSlice';
import type { TabMasterContainer } from './slices/tabContainerDataStateSlice';

// The two fields the answer reads. RootState satisfies it, so useSelector
// takes the selector as is.
export interface SavedSessionFoldState {
  settingsDataState: Pick<SettingsData, 'foldSavedSessionInTabView'>;
  globalState: Pick<Global, 'isPeekingSavedSession'>;
}

export interface OpenNowFoldState extends SavedSessionFoldState {
  settingsDataState: Pick<
    SettingsData,
    'foldSavedSessionInTabView' | 'foldOpenNowInTabView'
  >;
  globalState: Pick<Global, 'isPeekingSavedSession' | 'isPeekingOpenNow'>;
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

// KAN-808. Whether the tab view has Open now folded to its rail: the stored
// choice, unless a carry peeks it (KAN-1008), never while the saved session
// is folded, so Open now is not left with no column.
export const selectIsOpenNowFolded = (state: OpenNowFoldState): boolean =>
  state.settingsDataState.foldOpenNowInTabView &&
  !state.globalState.isPeekingOpenNow &&
  !selectIsSavedSessionFolded(state);

export interface SavedSessionCardState extends SavedSessionFoldState {
  tabContainerDataState: Pick<TabMasterContainer, 'tabGroups'>;
}

export const selectHasSavedSessions = (state: SavedSessionCardState): boolean =>
  state.tabContainerDataState.tabGroups.length > 0;

// KAN-999. Whether the folded saved session draws its card: folded, with a
// session to show. With none, the list's empty line already explains.
export const selectShowsSavedSessionCard = (
  state: SavedSessionCardState
): boolean =>
  selectIsSavedSessionFolded(state) && selectHasSavedSessions(state);
