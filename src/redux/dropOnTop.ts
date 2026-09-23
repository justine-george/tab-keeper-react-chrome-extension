import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { TabMasterContainer } from './slices/tabContainerDataStateSlice';
import { flushHeldChanges } from './dragHold';
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
export const dropOnTop =
  (drop: DropOnTop): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const before = drop.targetIds(getState().tabContainerDataState);
    if (!flushHeldChanges()) {
      dispatch(drop.move(drop.toIndex));
      return;
    }
    const now = getState().tabContainerDataState;
    const after = drop.targetIds(now);
    // The change deleted the row or its destination: the deletion stands.
    if (before === null || after === null || !drop.rowExists(now)) return;
    dispatch(drop.move(reaimIndex(before, after, drop.rowId, drop.toIndex)));
  };
