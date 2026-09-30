import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { dropOnTop } from './dropOnTop';
import { intoNewWindow, windowDrop } from './dropSpecs';
import { moveToSession } from './moveToSession';
import type {
  CarriedRef,
  TabMasterContainer,
} from './slices/tabContainerDataStateSlice';
import type { RootState } from './store';

// KAN-350 (S2 A). A carried item let go on a saved session's row: what the
// New window target would do. A tab or group becomes that session's new
// first window; a window becomes its first window.
//
// Returns whether anything moved, which is what the session list's take()
// reports, so a drop that changed nothing ends the carry as a cancel and the
// source's view is put back.
//
// The Moved toast goes out unless the row is the session on screen (Q3 A):
// a drop there is visible where it lands.
//
// A window let go on its OWN session's row goes through windowDrop, the
// reorder every window drag uses, because moveToSession's reducer declines a
// window moved within its session (by design: it is not a move between
// sessions). A tab or group on its own session's row IS a move to a new
// window, which that reducer takes.
export const dropOnSessionRow =
  (
    carried: CarriedRef,
    tabGroupId: string
  ): ThunkAction<boolean, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const announceMoved =
      getState().tabContainerDataState.selectedTabGroupId !== tabGroupId;

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
        // Moved or not is read off the move action, as moveToSession reads
        // it: the reducer returns the same state for a window already first.
        const drop = windowDrop(tabGroupId, carried.windowId, 0);
        const beforeMove: { state: TabMasterContainer | null } = {
          state: null,
        };
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
      }
    }
  };
