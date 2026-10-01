import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { dropOnTopMoved } from './dropOnTop';
import { intoNewWindow, windowDrop } from './dropSpecs';
import { moveToSession, movedToSessionToast } from './moveToSession';
import type { CarriedRef } from './slices/tabContainerDataStateSlice';
import type { RootState } from './store';
import { revealSavedWindow } from '../components/home/rightpane/revealSavedWindow';

// KAN-350 (S2 A). A carried item let go on a saved session's row: what the
// New window target would do. A tab or group becomes that session's new
// first window; a window becomes its first window.
//
// Returns whether anything moved, which is what the session list's take()
// reports, so a drop that changed nothing ends the carry as a cancel and the
// source's view is put back.
//
// The Moved toast goes out unless the row is the session on screen (Q3 A):
// a drop there is visible where it lands. The same for every kind, the
// item's own session's row included (the Show rule).
//
// A window let go on its OWN session's row goes through windowDrop, the
// reorder every window drag uses, because moveToSession's reducer declines a
// window moved within its session (by design: it is not a move between
// sessions). A tab or group on its own session's row IS a move to a new
// window, which that reducer takes.
//
// A drop that lands in the session on screen after it -- the one shown, or
// the one Q4 A shows in place of an emptied source -- is brought into view
// in the detail, where it lands first: the detail may be scrolled away.
export const dropOnSessionRow =
  (
    carried: CarriedRef,
    tabGroupId: string
  ): ThunkAction<boolean, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const announceMoved =
      getState().tabContainerDataState.selectedTabGroupId !== tabGroupId;

    const moved = dispatch(rowDropMove(carried, tabGroupId, announceMoved));
    if (!moved) return false;

    const after = getState().tabContainerDataState;
    const landed = after.tabGroups.find((g) => g.tabGroupId === tabGroupId)
      ?.windows[0]?.windowId;
    if (after.selectedTabGroupId === tabGroupId && landed !== undefined) {
      revealSavedWindow(landed);
    }
    return true;
  };

// The move a row drop makes, by kind, and its Moved toast. Says whether
// anything moved.
const rowDropMove =
  (
    carried: CarriedRef,
    tabGroupId: string,
    announceMoved: boolean
  ): ThunkAction<boolean, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    switch (carried.kind) {
      case 'tab':
        return dispatch(
          moveToSession({
            move: { carried, to: intoNewWindow(tabGroupId) },
            announceMoved,
          })
        );
      case 'group':
        return dispatch(
          moveToSession({
            move: { carried, to: intoNewWindow(tabGroupId) },
            announceMoved,
          })
        );
      case 'window': {
        if (carried.tabGroupId !== tabGroupId) {
          return dispatch(
            moveToSession({
              move: { carried, to: { tabGroupId, toIndex: 0 } },
              announceMoved,
            })
          );
        }
        // Read FIRST, as moveToSession reads it.
        const title = getState().tabContainerDataState.tabGroups.find(
          (g) => g.tabGroupId === tabGroupId
        )?.title;
        // Moved or not is read off the move action, as moveToSession reads
        // it: the reducer returns the same state for a window already first.
        const moved = dispatch(
          dropOnTopMoved(windowDrop(tabGroupId, carried.windowId, 0))
        );
        if (moved && announceMoved && title !== undefined) {
          dispatch(
            movedToSessionToast(
              { tabGroupId, title },
              getState().tabContainerDataState.selectedTabGroupId
            )
          );
        }
        return moved;
      }
    }
  };
