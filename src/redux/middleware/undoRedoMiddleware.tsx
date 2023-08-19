import { Middleware } from "@reduxjs/toolkit";
import { set } from "../slice/undoRedoSlice";
import {
  DELETE_TAB_ACTION,
  DELETE_TAB_CONTAINER_ACTION,
  DELETE_WINDOW_ACTION,
  REDO_ACTION,
  SAVE_TAB_CONTAINER_ACTION,
  SET_ACTION,
  TAB_CONTAINER_REPLACE_STATE_ACTION,
  UNDO_ACTION,
} from "../../utils/constants/actionTypes";

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

export const undoRedoMiddleware: Middleware = (store) => (next) => (action) => {
  console.log("Action received in undoRedoMiddleware:", action.type);

  if (!isCapturableAction(action.type)) {
    return next(action);
  }

  const prevState = store.getState();
  const result = next(action);
  const nextState = store.getState();

  if (isUndoRedoAction(action.type)) {
    const presentState = nextState.undoRedo.present;
    // update tabContainerDataState from the latest presentState
    store.dispatch({
      type: TAB_CONTAINER_REPLACE_STATE_ACTION,
      payload: presentState.tabContainerDataState,
    });
  } else if (isDataStateChangeAction(action.type, prevState, nextState)) {
    const { tabContainerDataState } = nextState;
    store.dispatch(set({ tabContainerDataState: tabContainerDataState }));
  }

  return result;
};
