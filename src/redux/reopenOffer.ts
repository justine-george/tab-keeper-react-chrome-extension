import { createAsyncThunk } from '@reduxjs/toolkit';

import { showToast } from './slices/globalStateSlice';
import { storeReopenOffer } from './reopenOfferStore';
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
