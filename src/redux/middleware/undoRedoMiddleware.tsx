import { Middleware } from "@reduxjs/toolkit";
import { set, undo, redo } from "../slice/undoRedoSlice";
import {
  deleteTab,
  deleteTabContainer,
  deleteWindow,
  saveToTabContainer,
} from "../slice/tabContainerDataStateSlice";

// add actions to capture under undo/redo
const actionsToCapture = [
  set.type,
  undo.type,
  redo.type,

  // actions in tabContainerDataStateSlice
  saveToTabContainer.type,
  deleteTabContainer.type,
  deleteWindow.type,
  deleteTab.type,
];

export const undoRedoMiddleware: Middleware = (store) => (next) => (action) => {
  console.log("Action received in undoRedoMiddleware:", action.type);

  if (!actionsToCapture.includes(action.type)) {
    return next(action);
  }
  const prevState = store.getState();
  const result = next(action);
  const nextState = store.getState();

  if (action.type === undo.type || action.type === redo.type) {
    const presentState = nextState.undoRedo.present;
    if (presentState) {
      // Restore all slices from present state
      Object.keys(presentState).forEach((sliceName) => {
        store.dispatch({
          type: `${sliceName}/replaceState`,
          payload: presentState[sliceName],
        });
      });
    }
  } else {
    const actionsToIgnoreForSet = [set.type, "replaceState"];

    if (
      prevState !== nextState &&
      !actionsToIgnoreForSet.includes(action.type)
    ) {
      const { undoRedo, ...restOfState } = nextState;
      store.dispatch(set(restOfState));
    }
  }

  return result;
};
