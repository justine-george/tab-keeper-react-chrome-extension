import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { dropOnTop } from './dropOnTop';
import { sessionMoveDrop } from './dropSpecs';
import { showToast } from './slices/globalStateSlice';
import type {
  SessionMove,
  TabMasterContainer,
} from './slices/tabContainerDataStateSlice';
import { TOAST_MESSAGES } from '../utils/constants/common';
import type { RootState } from './store';

export interface MoveToSessionParams {
  move: SessionMove;
  // Send "Moved to “{{title}}”". Only after a quick row drop (S5 A): a drop
  // into the session already on screen shows the move where it lands.
  announceMoved: boolean;
}

// KAN-350. Drop a carried tab, group or window into another saved session,
// through dropOnTop like every drop, and say what happened.
//
// Both titles are read FIRST: an emptied source is gone by the time there is
// anything to announce.
//
// The toasts go out only if the item actually left its source. dropOnTop may
// abandon the drop (a held change that failed to apply, or one that removed
// the item or the destination), and the reducer declines a move it can't
// make; either way nothing moved, and announcing it would be false. Whether
// it moved is read off the move itself: the container just before the move
// action is dispatched, against the container after it. The reducer returns
// the very same object when it declines.
//
// The Moved toast goes first, so the emptied one sits below it at the bottom
// of the stack. Show only when the target is not on screen after the move
// (the Show rule): under Q4 A an emptied source that was on screen hands the
// selection to the target, so that Moved toast has no Show. Both announce a
// saved change the user just made, so both take ⌘Z from a Reopen offer
// (KAN-349 Q1 C′).
export const moveToSession =
  ({
    move,
    announceMoved,
  }: MoveToSessionParams): ThunkAction<
    void,
    RootState,
    unknown,
    UnknownAction
  > =>
  (dispatch, getState) => {
    const titleOf = (tabGroupId: string) =>
      getState().tabContainerDataState.tabGroups.find(
        (g) => g.tabGroupId === tabGroupId
      )?.title;
    const sourceTitle = titleOf(move.carried.tabGroupId);
    const targetTitle = titleOf(move.to.tabGroupId);
    if (sourceTitle === undefined || targetTitle === undefined) return;

    const drop = sessionMoveDrop(move);
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

    const after = getState().tabContainerDataState;
    if (beforeMove.state === null || after === beforeMove.state) return;

    if (announceMoved) {
      dispatch(
        showToast({
          toastText: TOAST_MESSAGES.MOVED_TO_SESSION,
          toastParams: { title: targetTitle },
          duration: 8000,
          announcesSavedChange: true,
          show:
            after.selectedTabGroupId === move.to.tabGroupId
              ? undefined
              : { tabGroupId: move.to.tabGroupId },
        })
      );
    }

    const sourceRemoved = !after.tabGroups.some(
      (g) => g.tabGroupId === move.carried.tabGroupId
    );
    if (sourceRemoved) {
      dispatch(
        showToast({
          toastText: TOAST_MESSAGES.SESSION_EMPTIED_REMOVED,
          toastParams: { title: sourceTitle },
          duration: 5000,
          announcesSavedChange: true,
        })
      );
    }
  };
