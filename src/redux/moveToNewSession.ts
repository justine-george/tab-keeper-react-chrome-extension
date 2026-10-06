import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { dropOnTopMoved } from './dropOnTop';
import { newSessionDrop } from './dropSpecs';
import { showToast } from './slices/globalStateSlice';
import {
  moveToNewSessionInternal,
  type CarriedRef,
} from './slices/tabContainerDataStateSlice';
import { showSession } from './showSession';
import { TOAST_MESSAGES } from '../utils/constants/common';
import type { RootState } from './store';

// KAN-394 P3. Drop a carried item on the save row: it becomes a new session
// on top, shown. Through dropOnTop like every drop, so a change that arrived
// while carried is applied first. No Moved toast (4A): the new session is
// what the user sees. Returns whether it moved.
//
// The source's title is read FIRST: an emptied source is gone by the time
// there is anything to announce. The action is built once, and the new
// session's id is read off it.
export const moveToNewSession =
  (
    carried: CarriedRef,
    fallbackTitle: string,
    typedTitle: string = ''
  ): ThunkAction<boolean, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const sourceTitle = getState().tabContainerDataState.tabGroups.find(
      (g) => g.tabGroupId === carried.tabGroupId
    )?.title;
    if (sourceTitle === undefined) return false;

    const action = moveToNewSessionInternal(carried, fallbackTitle, typedTitle);
    const moved = dispatch(dropOnTopMoved(newSessionDrop(carried, action)));
    if (!moved) return false;

    const sourceRemoved = !getState().tabContainerDataState.tabGroups.some(
      (g) => g.tabGroupId === carried.tabGroupId
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
    dispatch(showSession(action.payload.tabGroupId));
    return true;
  };
