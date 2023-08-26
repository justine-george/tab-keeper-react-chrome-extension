import { Middleware } from '@reduxjs/toolkit';
import { set } from '../slice/undoRedoSlice';
import { setIsDirty, syncWithThunk } from '../slice/globalStateSlice';
import {
  DELETE_TAB_ACTION,
  DELETE_TAB_CONTAINER_ACTION,
  DELETE_WINDOW_ACTION,
  REDO_ACTION,
  SAVE_TAB_CONTAINER_ACTION,
  SET_ACTION,
  TAB_CONTAINER_REPLACE_STATE_ACTION,
  UNDO_ACTION,
  IS_DIRTY_ACTION,
} from '../../utils/constants/actionTypes';
import { debounce } from '../../utils/helperFunctions';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';

// add actions to capture under undo/redo
const actionsToCapture = [
  SET_ACTION,
  UNDO_ACTION,
  REDO_ACTION,

  // actions in tabContainerDataStateSlice
  SAVE_TAB_CONTAINER_ACTION,
  DELETE_TAB_CONTAINER_ACTION,
  DELETE_WINDOW_ACTION,
  DELETE_TAB_ACTION,

  // actions in globalStateSlice
  IS_DIRTY_ACTION,
];

const isCapturableAction = (type: string) => actionsToCapture.includes(type);

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
  ];
  return (
    prevState.tabContainerDataState !== nextState.tabContainerDataState &&
    !actionsToIgnoreForSet.includes(type)
  );
};

export const customMiddleware: Middleware = (store) => {
  const debouncedSync = debounce(() => {
    console.log('debounced sync');
    store.dispatch(syncWithThunk() as any);
  }, DEBOUNCE_TIME_WINDOW);

  return (next) => (action) => {
    // console.log("Action received in customMiddleware:", action.type);

    if (!isCapturableAction(action.type)) {
      return next(action);
    }

    const prevState = store.getState();
    const result = next(action);
    const nextState = store.getState();

    // After processing the action, check if it was setIsDirty and the flag is true
    if (
      action.type === setIsDirty.type &&
      nextState.globalState.isDirty &&
      nextState.globalState.isSignedIn &&
      nextState.settingsDataState.isAutoSync
    ) {
      debouncedSync();
    }

    if (isUndoRedoAction(action.type)) {
      const presentState = nextState.undoRedo.present;
      // update tabContainerDataState from the latest presentState
      store.dispatch({
        type: TAB_CONTAINER_REPLACE_STATE_ACTION,
        payload: presentState.tabContainerDataState,
      });
      console.log('Dispatch undoRedo dirty!!!!!!');
      store.dispatch(setIsDirty());
    } else if (isDataStateChangeAction(action.type, prevState, nextState)) {
      const { tabContainerDataState } = nextState;
      store.dispatch(set({ tabContainerDataState: tabContainerDataState }));

      console.log('Dispatch set dirty!!!!!!');
      store.dispatch(setIsDirty());
    }

    return result;
  };
};
