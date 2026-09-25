import { createAsyncThunk } from '@reduxjs/toolkit';

import { closeToast, showToast } from './slices/globalStateSlice';
import { expectReopenedRow } from './reopenFocus';
import { storeReopenOffer, takeReopenOffer } from './reopenOfferStore';
import { reopenClosed } from '../utils/functions/reopen';
import type { ClosedItem } from '../utils/functions/reopen';
import { TOAST_MESSAGES, WINDOW_CLOSED_FRAME } from '../utils/constants/common';

export { takeReopenOffer } from './reopenOfferStore';

// KAN-280 O8a. Longer than a plain toast's 5s: this one asks for a decision.
export const REOPEN_TOAST_MS = 8000;

// Shows "Tab closed" / "Window closed (N tabs)" with Reopen for
// REOPEN_TOAST_MS, replacing whatever toast (and offer) was showing.
export const offerReopen = createAsyncThunk(
  'global/offerReopen',
  async (item: ClosedItem, thunkAPI) => {
    const reopenOfferId = storeReopenOffer(item);
    await thunkAPI.dispatch(
      item.kind === 'tab'
        ? showToast({
            toastText: TOAST_MESSAGES.TAB_CLOSED,
            duration: REOPEN_TOAST_MS,
            reopenOfferId,
          })
        : showToast({
            toastText: WINDOW_CLOSED_FRAME,
            toastParams: { count: item.window.tabs.length },
            duration: REOPEN_TOAST_MS,
            reopenOfferId,
          })
    );
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
    thunkAPI.dispatch(closeToast());
    const reopened = await reopenClosed(item);
    if (reopened === null) {
      await thunkAPI.dispatch(
        showToast({ toastText: TOAST_MESSAGES.REOPEN_FAILED })
      );
      return;
    }
    expectReopenedRow(reopened);
  }
);
