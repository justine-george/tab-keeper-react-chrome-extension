import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import {
  TabMasterContainer,
  initialState as tabContainerDataInitialState,
} from './tabContainerDataStateSlice';
import { RootState } from '../store';
import { STACK_LEVEL } from '../../utils/constants/common';

export interface UndoableStates {
  tabContainerDataState: TabMasterContainer;

  // The sessions this step brought into existence, recorded when the step is
  // pushed rather than worked out when it is popped (KAN-80).
  //
  // Undoing a create has to leave a tombstone, or the copy auto-sync already
  // pushed to the cloud unions straight back and the undo silently reverses.
  // Knowing WHICH session to withdraw is the whole difficulty: two previous
  // attempts derived it by diffing the snapshot against something, and both
  // were wrong, because every pair available at pop time has drifted --
  // `replaceState` (the merge) enters the container but no snapshot, and
  // `setPresentStartup` refreshes `present` but never `past`. So a session that
  // merely ARRIVED from another device is indistinguishable from one the user
  // retracted, and KAN-83 was that conflation deleting other devices' sessions.
  //
  // At push time no such ambiguity exists: the middleware holds the state from
  // immediately before and immediately after the action, one instant apart,
  // with no room for a cloud arrival in between. What that step added is a
  // fact, so it is recorded as one instead of being reconstructed later.
  addedTabGroupIds?: string[];
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
    // Also dispatched after every merge, not only at startup, which is why it
    // carries `addedTabGroupIds` forward (KAN-80).
    //
    // A sync arriving is not a step the user took, so it cannot retract one
    // they did take. The reported ordering is create, auto-sync, undo -- so
    // dropping the ids here disarmed the withdrawal in exactly the case the
    // bug was reported in, while leaving every test that syncs before the
    // undone step green.
    setPresentStartup: (state, action: PayloadAction<UndoableStates>) => {
      state.present = {
        ...action.payload,
        addedTabGroupIds: state.present.addedTabGroupIds,
      };
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
    //
    // Carries `addedTabGroupIds` forward from the present it replaces. This is
    // not bookkeeping: selecting a session is not a new step, so the last real
    // edit is still the one an undo would retract. Dropping the ids here would
    // mean creating a session and then clicking any other row silently
    // disarmed the withdrawal, which is an ordinary thing to do -- and the
    // resulting bug would look exactly like KAN-80 coming back.
    setPresentWithoutHistory: (
      state,
      action: PayloadAction<UndoableStates>
    ) => {
      state.present = {
        ...action.payload,
        addedTabGroupIds: state.present.addedTabGroupIds,
      };
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
