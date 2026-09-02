import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import {
  TabMasterContainer,
  initialState as tabContainerDataInitialState,
} from './tabContainerDataStateSlice';
import { RootState } from '../store';
import { STACK_LEVEL } from '../../utils/constants/common';

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
  name: 'undoRedo',
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

        // update lastModified when undoing
        state.present.tabContainerDataState.lastModified = Date.now();
      }
    },
    redo: (state) => {
      if (state.future.length !== 0) {
        state.past.push(state.present!);
        state.present = state.future.shift()!;

        // update lastModified when redoing
        state.present.tabContainerDataState.lastModified = Date.now();
      }
    },
    setPresentStartup: (state, action: PayloadAction<UndoableStates>) => {
      state.present = action.payload;
    },

    // Keep `present` in step with the store without recording an undoable step
    // (KAN-57).
    //
    // For changes that are not edits -- selecting a session is the only one
    // today. `present` still has to move, or the next undo would restore a
    // stale selection; but `past` must not grow, and above all `future` must
    // not be cleared. `set` clears it because a genuine new edit invalidates
    // the redo branch, and selection creates no such branch: renaming, undoing,
    // then clicking any other session used to make the rename unrecoverable.
    //
    // Distinct from setPresentStartup, which happens to have the same body.
    // That one restores history at boot; sharing it would make a name that
    // says "startup" carry the selection path too.
    setPresentWithoutHistory: (
      state,
      action: PayloadAction<UndoableStates>
    ) => {
      state.present = action.payload;
    },
  },
});

export const { set, undo, redo, setPresentStartup, setPresentWithoutHistory } =
  undoRedoSlice.actions;

// selectors
export const isUndoableSelector = (state: RootState) =>
  state.undoRedo.past.length > 0;
export const isRedoableSelector = (state: RootState) =>
  state.undoRedo.future.length > 0;

export default undoRedoSlice.reducer;
