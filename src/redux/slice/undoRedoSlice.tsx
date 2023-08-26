import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import {
  TabMasterContainer,
  initialState as tabContainerDataInitialState,
} from "./tabContainerDataStateSlice";
import { RootState } from "../store";
import { STACK_LEVEL } from "../../utils/constants/common";

export interface UndoableStates {
  tabContainerDataState: TabMasterContainer;
}

export interface undoRedoState {
  past: UndoableStates[];
  present: UndoableStates;
  future: UndoableStates[];
}

const initialState: undoRedoState = {
  past: [],
  present: {
    tabContainerDataState: tabContainerDataInitialState,
  },
  future: [],
};

export const undoRedoSlice = createSlice({
  name: "undoRedo",
  initialState,
  reducers: {
    set: (state, action: PayloadAction<UndoableStates>) => {
      state.past.push(state.present);
      // if past has more than STACK_LEVEL states, remove the oldest one.
      if (state.past.length > STACK_LEVEL) {
        state.past.shift();
      }
      state.present = action.payload;
      state.future = [];
    },
    undo: (state) => {
      if (state.past.length !== 0) {
        state.future.unshift(state.present!);
        state.present = state.past.pop()!;
      }
    },
    redo: (state) => {
      if (state.future.length !== 0) {
        state.past.push(state.present!);
        state.present = state.future.shift()!;
      }
    },
    setPresentStartup: (state, action: PayloadAction<UndoableStates>) => {
      state.present = action.payload;
    },
  },
});

export const { set, undo, redo, setPresentStartup } = undoRedoSlice.actions;

// selectors
export const isUndoableSelector = (state: RootState) =>
  state.undoRedo.past.length > 0;
export const isRedoableSelector = (state: RootState) =>
  state.undoRedo.future.length > 0;

export default undoRedoSlice.reducer;
