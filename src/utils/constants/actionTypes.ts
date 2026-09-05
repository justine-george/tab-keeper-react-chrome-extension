// undoRedo actions
export const SET_ACTION = 'undoRedo/set';
export const UNDO_ACTION = 'undoRedo/undo';
export const REDO_ACTION = 'undoRedo/redo';

// tabContainerDataState actions
export const TAB_CONTAINER_REPLACE_STATE_ACTION =
  'tabContainerDataState/replaceState';

// Undo/redo and import both restore a container the user is asserting, and
// unlike replaceState they may need to withdraw a tombstone; see
// restoreContainer in tabContainerDataStateSlice.
export const TAB_CONTAINER_RESTORE_ACTION =
  'tabContainerDataState/restoreContainer';

// Undo/redo only. Same reconciliation as restoreContainer, plus withdrawing the
// sessions the undone step created; import must never take this path (KAN-80).
export const TAB_CONTAINER_APPLY_UNDO_SNAPSHOT_ACTION =
  'tabContainerDataState/applyUndoSnapshot';
export const SELECT_TAB_CONTAINER_ACTION =
  'tabContainerDataState/selectTabContainer';
export const SAVE_TAB_CONTAINER_ACTION =
  'tabContainerDataState/saveToTabContainerInternal';
export const ADD_CURR_WINDOW_TO_TABGROUP_ACTION =
  'tabContainerDataState/addCurrWindowToTabGroupInternal';
export const ADD_CURR_TAB_TO_WINDOW_ACTION =
  'tabContainerDataState/addCurrTabToWindowInternal';
export const EDIT_TABGROUP_TITLE_ACTION =
  'tabContainerDataState/updateTabGroupTitle';
export const EDIT_WINDOWGROUP_TITLE_ACTION =
  'tabContainerDataState/updateWindowGroupTitle';
export const DELETE_TAB_CONTAINER_ACTION =
  'tabContainerDataState/deleteTabContainerInternal';
export const DELETE_WINDOW_ACTION =
  'tabContainerDataState/deleteWindowInternal';
export const DELETE_TAB_ACTION = 'tabContainerDataState/deleteTabInternal';

// global actions
export const IS_DIRTY_ACTION = 'globalState/setIsDirty';
