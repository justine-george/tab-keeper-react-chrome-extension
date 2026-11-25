import { createAsyncThunk } from '@reduxjs/toolkit';
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { closeOfferToast, showToast } from './slices/globalStateSlice';
import { expectReopenedRow } from './reopenFocus';
import {
  reopenOfferKind,
  storeReopenOffer,
  takeReopenOffer,
} from './reopenOfferStore';
import type { RootState } from './store';
import { reopenClosed } from '../utils/functions/reopen';
import { whileMovingTabs } from './undoHistory';
import { panes, prepareLayoutGlide } from '../components/common/layoutGlide';
import type { ClosedItem } from '../utils/functions/reopen';
import {
  GROUP_CLOSED_FRAME,
  TOAST_MESSAGES,
  WINDOW_CLOSED_FRAME,
} from '../utils/constants/common';

export { takeReopenOffer } from './reopenOfferStore';

function closedToast(item: ClosedItem, reopenOfferId: number) {
  switch (item.kind) {
    case 'tab':
      return showToast({ toastText: TOAST_MESSAGES.TAB_CLOSED, reopenOfferId });
    case 'group':
      return showToast({
        toastText: GROUP_CLOSED_FRAME,
        toastParams: { count: item.tabs.length },
        reopenOfferId,
      });
    case 'window':
      return showToast({
        toastText: WINDOW_CLOSED_FRAME,
        toastParams: { count: item.window.tabs.length },
        reopenOfferId,
      });
    case 'duplicateTabs':
      return showToast({
        toastText: TOAST_MESSAGES.DUPLICATE_TABS_CLOSED,
        toastParams: {
          count: item.closed.reduce((n, w) => n + w.tabs.length, 0),
        },
        reopenOfferId,
      });
  }
}

// Shows "Tab closed" / "Group closed (N tabs)" / "Window closed (N tabs)" / "Closed N duplicate tabs." with Reopen, for
// NEEDS_YOU_TOAST_MS (KAN-508: it asks for a decision). It replaces the offer
// showing, in its place in the stack (KAN-349 T4); other toasts stay.
export const offerReopen = createAsyncThunk(
  'global/offerReopen',
  async (item: ClosedItem, thunkAPI) => {
    const reopenOfferId = storeReopenOffer(item);
    await thunkAPI.dispatch(closedToast(item, reopenOfferId));
  }
);

// Takes the offer and reopens what it names: the Reopen button and the ⌘Z /
// Ctrl+Z key both come here (KAN-311, O8c). An offer already taken, or
// replaced, does nothing and leaves whatever toast shows now. Nothing coming
// back says so (rule 10); anything that does gets focus once Open now lists
// it.
export const reopenFromOffer = createAsyncThunk(
  'global/reopenFromOffer',
  async (offerId: number, thunkAPI) => {
    const item = takeReopenOffer(offerId);
    if (item === null) return;
    thunkAPI.dispatch(closeOfferToast(offerId));
    const pin = (thunkAPI.getState() as RootState).settingsDataState
      .pinTabKeeperInNewWindows;
    // KAN-1001. Recreated here, in steps (a group's tabs, then grouped, then
    // named and coloured): Currently open reads it once, whole, so it never
    // draws a step between and the Reopen glide plays on the finished list.
    // The worker's restore has no timeout (reopenClosed), so it is not held.
    const reopened = await (item.restorableSessionId === null
      ? whileMovingTabs(() => reopenClosed(item, pin))
      : reopenClosed(item, pin));
    if (reopened === null) {
      await thunkAPI.dispatch(
        showToast({ toastText: TOAST_MESSAGES.REOPEN_FAILED })
      );
      return;
    }
    expectReopenedRow(reopened);
  }
);

// Every Reopen: the toast's chip, ⌘Z, or the header Undo while ⌘Z would take
// the offer (KAN-997). Every offer is a close in Currently open, so its gap
// opens again as it closed (KAN-987).
export const pressReopen =
  (
    offerId: number
  ): ThunkAction<Promise<unknown>, RootState, undefined, UnknownAction> =>
  (dispatch) => {
    // An undo, so it plays from the keys too; closed duplicates come back lit (KAN-996).
    prepareLayoutGlide(panes('open-now'), 'delete', 'undo or redo', {
      lightReturns: reopenOfferKind(offerId) === 'duplicateTabs',
    });
    return dispatch(reopenFromOffer(offerId));
  };
