import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import {
  stepSince,
  type TabMasterContainer,
} from './slices/tabContainerDataStateSlice';
import { noteStep } from './stepGlides';
import { flushHeldChanges } from './dragHold';
import { hydrateSessionsFromStorage } from './otherPageChanges';
import { reaimIndex } from '../utils/functions/reaimIndex';

export interface DropOnTop {
  rowId: string;
  toIndex: number;
  // Ids of the list the move reducer applies toIndex to, read from a state;
  // null when that list (its session, window or Chrome group) is gone.
  targetIds: (s: TabMasterContainer) => string[] | null;
  // Whether the held row still exists in its source.
  rowExists: (s: TabMasterContainer) => boolean;
  move: (toIndex: number) => UnknownAction;
}

// KAN-279 D12. The drop acts ON TOP of any change that arrived while the row
// was held: that change is applied first, then the move, re-aimed by neighbour.
// The other order -- move in the old list, merge the change in after -- loses
// edits: a session drop with no rank room renormalises, touching EVERY session,
// and a later per-session merge then prefers all of them over the other side.
//
// A held change that failed to apply abandons the drop: state never took it
// in, and the move's own localStorage write would save over it (the loss this
// ordering exists to prevent). flushHeldChanges has already logged it.
//
// Then localStorage is re-read, whatever the queue held (D9: "a re-read of
// localStorage at drop"). Another page's write can reach localStorage before
// its storage event reaches this page, so an empty queue does not mean
// nothing changed. For a page alone localStorage equals state, the re-read
// is a no-op, and the drop dispatches exactly the move it was aimed with.
export const dropOnTop =
  (drop: DropOnTop): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const start = getState().tabContainerDataState;
    const before = drop.targetIds(start);
    const flushed = flushHeldChanges();
    if (!flushed.allApplied) return;
    dispatch(hydrateSessionsFromStorage());
    const now = getState().tabContainerDataState;
    if (!flushed.ran && now === start) {
      dropNoted(() => dispatch(drop.move(drop.toIndex)), getState);
      return;
    }
    const after = drop.targetIds(now);
    // The change deleted the row or its destination: the deletion stands.
    if (before === null || after === null || !drop.rowExists(now)) return;
    dropNoted(
      () =>
        dispatch(
          drop.move(reaimIndex(before, after, drop.rowId, drop.toIndex))
        ),
      getState
    );
  };

// KAN-994. Every drop's undo leaves its landing the way it came, and its redo
// lands again (his rule from round 1b), in either pane.
function dropNoted(move: () => void, getState: () => RootState): void {
  const history = getState().undoRedo.present;
  move();
  noteStep(stepSince(getState, history), ['detail', 'sessions'], 'drop');
}

// A drop that says whether it moved anything (KAN-350): a carry that ends
// with nothing moved is a cancel, and puts its source's view back. Read off
// the move itself, as moveToSession reads it: the container just before the
// move action is dispatched against the container after it. The reducer
// returns the very same object for a move that changes nothing, and dropOnTop
// may abandon the drop before any move is dispatched at all.
export const dropOnTopMoved =
  (drop: DropOnTop): ThunkAction<boolean, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const beforeMove: { state: TabMasterContainer | null } = { state: null };
    dispatch(
      dropOnTop({
        ...drop,
        move: (toIndex) => {
          beforeMove.state = getState().tabContainerDataState;
          return drop.move(toIndex);
        },
      })
    );
    return (
      beforeMove.state !== null &&
      getState().tabContainerDataState !== beforeMove.state
    );
  };
