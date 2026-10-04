import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import {
  closePinGuide,
  openFullViewOffer,
  openPinGuide,
} from './slices/globalStateSlice';
import { beginSetup } from './slices/settingsDataStateSlice';
import {
  shouldOfferFullView,
  shouldShowPinGuide,
} from '../utils/functions/onboarding';
import { readToolbarPin } from '../utils/functions/toolbarPin';
import { isTabView } from '../utils/functions/viewMode';

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// KAN-7 §8. The full view's first-open chain: the pin guide when it applies.
export const followInFullView =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const pin = await readToolbarPin();
    if (shouldShowPinGuide(getState().settingsDataState, pin)) {
      dispatch(openPinGuide());
    }
  };

// KAN-7 §8. The welcome (a new install) closed, by any answer: setup is now
// pending. The popup offers the full view; the full view runs its own chain.
export const followWelcome =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    dispatch(beginSetup());
    if (isTabView()) {
      await dispatch(followInFullView());
      return;
    }
    if (shouldOfferFullView(getState().settingsDataState)) {
      dispatch(openFullViewOffer());
    }
  };

// KAN-7 §4. The guide closing, by a pin, Skip, ✕ or Esc.
export const leavePinGuide = (): Thunk<void> => (dispatch) => {
  dispatch(closePinGuide());
};
