// KAN-350. A carried item let go at an exact spot in the session on
// screen, after the drag engine adopted it (RowDragArea's adoptRowId). One
// thunk per kind, each taking the spot as the detail DRAWS it, and routing
// it:
//
//   - on a New window target: moveToSession, as a new window of whichever
//     session is on screen (Q2 A) -- first on the session header's
//     (NEW_FIRST_WINDOW, KAN-361 N1 B, S3 A), last in the list's trailing
//     block (NEW_LAST_WINDOW, KAN-366 B), which is where an adopted
//     phantom rests, so a release at its own place makes a new last window;
//   - in the item's OWN session: today's tabDrop / groupDrop / windowDrop,
//     from the item's original window, so their no-op guards and prune rules
//     are unchanged (plan Decision). The detail drew the session with the
//     item already lifted out, which is the list those builders' indices
//     count in -- see their comments;
//   - in another session: moveToSession, at that exact spot.
//
// None sends a Moved toast: the move is on screen where it lands (S5 A).
// Each returns whether the item moved, so the carry ends as committed only
// when it did.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { dropOnTopMoved } from './dropOnTop';
import { groupDrop, intoNewWindow, tabDrop, windowDrop } from './dropSpecs';
import { moveToSession } from './moveToSession';
import type { CarriedRef } from './slices/tabContainerDataStateSlice';
import type { RootState } from './store';
import { newWindowPlacement } from '../components/home/rightpane/newWindowTarget';

type Moved = ThunkAction<boolean, RootState, unknown, UnknownAction>;

// Where in the session on screen a tab or group was let go: `toIndex` counts
// `toWindowId`'s rows as drawn, with the carried item not among them.
export interface CarriedSpot {
  tabGroupId: string;
  toWindowId: string;
  toIndex: number;
}

export const dropCarriedTab =
  (
    carried: Extract<CarriedRef, { kind: 'tab' }>,
    // The band the release landed in, if any: the tab joins that group.
    spot: CarriedSpot & { toChromeGroupId?: string }
  ): Moved =>
  (dispatch) => {
    const { tabGroupId, toWindowId, toIndex, toChromeGroupId } = spot;
    const at = newWindowPlacement(toWindowId);
    if (at !== undefined) {
      return dispatch(
        moveToSession({
          move: { carried, to: intoNewWindow(tabGroupId, at) },
          announceMoved: false,
        })
      );
    }
    if (carried.tabGroupId === tabGroupId) {
      return dispatch(
        dropOnTopMoved(
          tabDrop({
            tabGroupId,
            tabId: carried.tabId,
            fromWindowId: carried.windowId,
            toWindowId,
            toIndex,
            toChromeGroupId,
          })
        )
      );
    }
    return dispatch(
      moveToSession({
        move: {
          carried,
          to: { tabGroupId, windowId: toWindowId, toIndex, toChromeGroupId },
        },
        announceMoved: false,
      })
    );
  };

// A group never lands inside another group: the items list asks no band.
export const dropCarriedGroup =
  (carried: Extract<CarriedRef, { kind: 'group' }>, spot: CarriedSpot): Moved =>
  (dispatch) => {
    const { tabGroupId, toWindowId, toIndex } = spot;
    const at = newWindowPlacement(toWindowId);
    if (at !== undefined) {
      return dispatch(
        moveToSession({
          move: { carried, to: intoNewWindow(tabGroupId, at) },
          announceMoved: false,
        })
      );
    }
    if (carried.tabGroupId === tabGroupId) {
      return dispatch(
        dropOnTopMoved(
          groupDrop({
            tabGroupId,
            groupId: carried.groupId,
            fromWindowId: carried.windowId,
            toWindowId,
            toIndex,
          })
        )
      );
    }
    return dispatch(
      moveToSession({
        move: { carried, to: { tabGroupId, windowId: toWindowId, toIndex } },
        announceMoved: false,
      })
    );
  };

// A window lands between windows: `toIndex` counts the session's windows as
// drawn, with the carried one not among them. There is no New window target
// for a window (S3 A).
export const dropCarriedWindow =
  (
    carried: Extract<CarriedRef, { kind: 'window' }>,
    spot: { tabGroupId: string; toIndex: number }
  ): Moved =>
  (dispatch) => {
    const { tabGroupId, toIndex } = spot;
    if (carried.tabGroupId === tabGroupId) {
      return dispatch(
        dropOnTopMoved(windowDrop(tabGroupId, carried.windowId, toIndex))
      );
    }
    return dispatch(
      moveToSession({
        move: { carried, to: { tabGroupId, toIndex } },
        announceMoved: false,
      })
    );
  };
