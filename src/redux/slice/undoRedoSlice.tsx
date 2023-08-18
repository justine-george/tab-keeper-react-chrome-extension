import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { IndividualStates } from "../../utils/types";
import { initialState as globalInitialState } from "./globalStateSlice";
import { initialState as settingsCategoryInitialState } from "./settingsCategoryStateSlice";
import { initialState as settingsDataInitialState } from "./settingsDataStateSlice";
import { initialState as tabContainerDataInitialState } from "./tabContainerDataStateSlice";
import { RootState } from "../store";

export interface undoRedoState {
  past: IndividualStates[];
  present: IndividualStates | null;
  future: IndividualStates[];
}

const initialState: undoRedoState = {
  past: [],
  present: {
    globalState: globalInitialState,
    settingsCategoryState: settingsCategoryInitialState,
    settingsDataState: settingsDataInitialState,
    tabContainerDataState: tabContainerDataInitialState,
  },
  future: [],
};

export const undoRedoSlice = createSlice({
  name: "undoRedo",
  initialState,
  reducers: {
    set: (state, action: PayloadAction<IndividualStates>) => {
      console.log("Inside set reducer");
      console.log(action);
      if (state.present) {
        console.log("Already present");
        state.past.push(state.present);
        // if past has more than 10 states, remove the oldest one.
        if (state.past.length > 10) {
          state.past.shift();
        }
        state.present = action.payload;
        state.future = [];
      }
    },
    undo: (state) => {
      console.log("Inside undo reducer");
      if (state.past.length !== 0) {
        state.future.unshift(state.present!);
        state.present = state.past.pop() || null;
      }
      console.log(state);
    },
    redo: (state) => {
      if (state.future.length !== 0) {
        state.past.push(state.present!);
        state.present = state.future.shift() || null;
      }
      console.log(state);
    },
  },
});

export const { set, undo, redo } = undoRedoSlice.actions;

// selectors
export const isUndoableSelector = (state: RootState) =>
  state.undoRedo.past.length > 0;
export const isRedoableSelector = (state: RootState) =>
  state.undoRedo.future.length > 0;

export default undoRedoSlice.reducer;
