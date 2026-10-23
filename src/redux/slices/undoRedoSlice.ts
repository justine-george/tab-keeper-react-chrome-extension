import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import type { TabMasterContainer } from './tabContainerDataStateSlice';
import { initialState as tabContainerDataInitialState } from './tabContainerInitialState';
import type { RootState } from '../store';
import { STACK_LEVEL } from '../../utils/constants/common';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';

// An Open now move (sort or drag) that sits in the same history as saved edits
// (KAN-744). `id` comes from nextActionNumber().
export interface LiveStep {
  id: number;
  drop: OpenNowDrop;
}

// Immer drafts are mutable, and a drop's `moved` is readonly; copying the array
// is how a step gets into the draft without a cast.
function writable(step: LiveStep) {
  return {
    id: step.id,
    drop: { kind: step.drop.kind, moved: [...step.drop.moved] },
  };
}

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

  // The Open now move that led into this state, same meaning as above. Live
  // steps never change the saved container, so every such state shares it.
  liveStep?: LiveStep;
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
      const { liveStep } = action.payload;
      state.present = {
        ...action.payload,
        liveStep: liveStep && writable(liveStep),
      };
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
    // Dispatched only until the first sync completes (every caller is gated
    // on `!hasSyncedBefore`, which never goes back to false): by App's
    // local-only startup, by the sync's cloud-only / local-only / new-user
    // branches, and by its both-sides merge when that merge changed nothing
    // locally. A merge that did change local data goes through `resetHistory`
    // instead (D12, KAN-279). Never dispatched on a later sync. Carries
    // `addedTabGroupIds` forward (KAN-80) so a create made before the first
    // sync can still be withdrawn after it.
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
        liveStep: state.present.liveStep,
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
        liveStep: state.present.liveStep,
      };
    },

    // A live step is recorded, replied to and dropped by id, so a late reply for
    // a step that is no longer where it was cannot move the wrong one.
    pushLiveStep: (state, action: PayloadAction<LiveStep>) => {
      state.past.push(state.present);
      if (state.past.length > STACK_LEVEL) {
        state.past.shift();
      }
      state.present = {
        tabContainerDataState: state.present.tabContainerDataState,
        addedTabGroupIds: [],
        liveStep: writable(action.payload),
      };
      state.future = [];
    },
    liveStepUndone: (state, action: PayloadAction<LiveStep>) => {
      if (state.present.liveStep?.id !== action.payload.id) return;
      const previous = state.past.pop();
      if (!previous) return;
      state.future.unshift({
        ...state.present,
        liveStep: writable(action.payload),
      });
      state.present = {
        ...previous,
        tabContainerDataState: state.present.tabContainerDataState,
      };
    },
    liveStepRedone: (state, action: PayloadAction<LiveStep>) => {
      if (state.future[0]?.liveStep?.id !== action.payload.id) return;
      state.past.push(state.present);
      if (state.past.length > STACK_LEVEL) {
        state.past.shift();
      }
      state.present = {
        tabContainerDataState: state.present.tabContainerDataState,
        addedTabGroupIds: [],
        liveStep: writable(action.payload),
      };
      state.future.shift();
    },
    liveStepDropped: (state, action: PayloadAction<{ id: number }>) => {
      const { id } = action.payload;
      if (state.present.liveStep?.id === id) {
        const previous = state.past.pop();
        if (!previous) return;
        state.present = {
          ...previous,
          tabContainerDataState: state.present.tabContainerDataState,
        };
        return;
      }
      const at = state.future.findIndex((s) => s.liveStep?.id === id);
      if (at !== -1) state.future.splice(at, 1);
    },

    // D12 (KAN-279). A change this page did not make -- another page's write,
    // or a cloud merge that changed local data -- leaves nothing here that a
    // saved undo may reverse. The added ids go too: carrying them only makes
    // sense while `past` survives, and they could name sessions the other side
    // has already deleted. Live steps stay (KAN-744): the tabs they moved are
    // still moved, whatever the cloud said.
    resetHistory: (
      state,
      action: PayloadAction<{ tabContainerDataState: TabMasterContainer }>
    ) => {
      const loaded = action.payload.tabContainerDataState;
      const base = {
        tabContainerDataState: loaded,
        addedTabGroupIds: [],
      };
      const relive = ({ liveStep }: UndoableStates) => ({
        tabContainerDataState: loaded,
        addedTabGroupIds: [],
        liveStep: liveStep && writable(liveStep),
      });
      // past[0] is the base; every later entry, and present, is a step.
      const kept = [...state.past.slice(1), state.present]
        .filter((s) => s.liveStep)
        .map(relive);
      const last = kept[kept.length - 1];
      state.past = last ? [base, ...kept.slice(0, -1)] : [];
      state.present = last ?? base;
      state.future = state.future.filter((s) => s.liveStep).map(relive);
    },
  },
});

export const {
  set,
  undo,
  redo,
  setPresentStartup,
  setPresentWithoutHistory,
  pushLiveStep,
  liveStepUndone,
  liveStepRedone,
  liveStepDropped,
  resetHistory,
} = undoRedoSlice.actions;

// selectors
export const isUndoableSelector = (state: RootState) =>
  state.undoRedo.past.length > 0;
export const isRedoableSelector = (state: RootState) =>
  state.undoRedo.future.length > 0;

// Which kind of step the next undo or redo takes, whatever order they were made in.
export const selectNextStep = (
  state: RootState,
  direction: 'undo' | 'redo'
): 'saved' | 'live' | null => {
  const { past, present, future } = state.undoRedo;
  const entry = direction === 'undo' ? present : future[0];
  if (direction === 'undo' ? past.length === 0 : !entry) return null;
  return entry.liveStep ? 'live' : 'saved';
};
export const selectNewestLiveStep = (state: RootState): LiveStep | null =>
  state.undoRedo.past.length > 0
    ? (state.undoRedo.present.liveStep ?? null)
    : null;

export default undoRedoSlice.reducer;
