import { isAction, Middleware } from '@reduxjs/toolkit';

import { set, setPresentWithoutHistory } from '../slices/undoRedoSlice';
import { debounce } from '../../utils/functions/local';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';
import { setIsDirty, syncStateWithFirestore } from '../slices/globalStateSlice';
import {
  ADD_CURR_WINDOW_TO_TABGROUP_ACTION,
  ADD_CURR_TAB_TO_WINDOW_ACTION,
  DELETE_TAB_ACTION,
  DELETE_TAB_CONTAINER_ACTION,
  DELETE_WINDOW_ACTION,
  EDIT_TABGROUP_TITLE_ACTION,
  IS_DIRTY_ACTION,
  REDO_ACTION,
  SAVE_TAB_CONTAINER_ACTION,
  SELECT_TAB_CONTAINER_ACTION,
  SET_ACTION,
  TAB_CONTAINER_REPLACE_STATE_ACTION,
  TAB_CONTAINER_RESTORE_ACTION,
  UNDO_ACTION,
  EDIT_WINDOWGROUP_TITLE_ACTION,
} from '../../utils/constants/actionTypes';

// add actions to capture under undo/redo
const actionsToCapture = [
  SET_ACTION,
  UNDO_ACTION,
  REDO_ACTION,
  SELECT_TAB_CONTAINER_ACTION,

  // actions in tabContainerDataStateSlice
  SAVE_TAB_CONTAINER_ACTION,
  ADD_CURR_WINDOW_TO_TABGROUP_ACTION,
  ADD_CURR_TAB_TO_WINDOW_ACTION,
  EDIT_TABGROUP_TITLE_ACTION,
  EDIT_WINDOWGROUP_TITLE_ACTION,
  DELETE_TAB_CONTAINER_ACTION,
  DELETE_WINDOW_ACTION,
  DELETE_TAB_ACTION,

  // actions in globalStateSlice
  IS_DIRTY_ACTION,
];

const isCapturableAction = (type: string) => actionsToCapture.includes(type);

// Actions that change what the user is looking at rather than what is stored.
// Selection is the only one today.
//
// These are tracked in history so `present` matches the screen, but they are
// neither synced (KAN-35) nor recorded as undoable steps (KAN-57). Both
// exclusions come off this one list because they are the same claim -- view
// state is not data -- applied to the two things the branch below decides.
//
// Selection has to be filtered here rather than by leaving it out of
// `actionsToCapture`, because that list is what keeps `present` in step at all;
// dropping it there would leave history restoring a stale selection.
//
// Nor is it enough to stop `selectTabContainer` bumping the container's
// `lastModified`: `isDataStateChangeAction` compares state *references*, and the
// reducer flips `isSelected` on every group regardless, so Immer hands back a
// new reference and the branch fires anyway.
//
// This covers search too. Typing dispatches `setSearchInputText`, which is not
// capturable at all; search reaches both consequences only because
// TabGroupEntryContainer selects the first filtered result on every keystroke.
const viewStateOnlyActions = [SELECT_TAB_CONTAINER_ACTION];

const isUndoRedoAction = (type: string) =>
  [UNDO_ACTION, REDO_ACTION].includes(type);

const isDataStateChangeAction = (
  type: string,
  prevState: any,
  nextState: any
) => {
  const actionsToIgnoreForSet = [
    SET_ACTION,
    TAB_CONTAINER_REPLACE_STATE_ACTION,
    // Restoring history is not a new edit to capture; capturing it would push
    // the restored state back onto the undo stack.
    TAB_CONTAINER_RESTORE_ACTION,
  ];
  return (
    prevState.tabContainerDataState !== nextState.tabContainerDataState &&
    !actionsToIgnoreForSet.includes(type)
  );
};

export const customMiddleware: Middleware = (store) => {
  const debouncedSync = debounce(() => {
    store.dispatch(syncStateWithFirestore() as any);
  }, DEBOUNCE_TIME_WINDOW);

  return (next) => (action) => {
    // Redux Toolkit 2 types this `unknown` rather than `AnyAction`, because a
    // middleware sits above the base dispatch and so sees whatever was handed
    // to it -- which is not guaranteed to be an action. isAction is RTK's own
    // guard, so this narrows rather than asserts; a cast would silence the
    // compiler while leaving `null.type` free to throw.
    //
    // Nothing in this app dispatches a non-action today (thunk middleware runs
    // ahead of this one and unwraps thunks before they arrive), so this is a
    // typing correction rather than a bug fix -- but the old code did throw a
    // TypeError on null or undefined, and now it passes them along instead.
    if (!isAction(action) || !isCapturableAction(action.type)) {
      return next(action);
    }

    const prevState = store.getState();
    const result = next(action);
    const nextState = store.getState();

    // After processing the action, check if it was setIsDirty and the flag is true
    // isFirebaseAuthed as well as isSignedIn: the first means a document id
    // exists, the second means the rules will accept a request. An edit made
    // inside the first second of a cold start satisfies only the first, and
    // syncing on it produces denied writes (KAN-70).
    if (
      action.type === setIsDirty.type &&
      nextState.globalState.isDirty &&
      nextState.globalState.isSignedIn &&
      nextState.globalState.isFirebaseAuthed &&
      nextState.settingsDataState.isAutoSync
    ) {
      debouncedSync();
    }

    if (isUndoRedoAction(action.type)) {
      const presentState = nextState.undoRedo.present;
      // update tabContainerDataState from the latest presentState
      //
      // restoreContainer rather than replaceState: a snapshot taken before a
      // delete brings the session back with no tombstone, but the cloud may
      // still hold the one that delete pushed up. Restoring blind lets the next
      // merge re-apply the delete, so undo appears to work and then reverses
      // itself.
      store.dispatch({
        type: TAB_CONTAINER_RESTORE_ACTION,
        payload: presentState.tabContainerDataState,
      });
      store.dispatch(setIsDirty());
    } else if (isDataStateChangeAction(action.type, prevState, nextState)) {
      const { tabContainerDataState } = nextState;
      const isViewStateOnly = viewStateOnlyActions.includes(action.type);

      store.dispatch(
        isViewStateOnly
          ? setPresentWithoutHistory({ tabContainerDataState })
          : set({ tabContainerDataState })
      );

      if (!isViewStateOnly) {
        store.dispatch(setIsDirty());
      }
    }

    return result;
  };
};
