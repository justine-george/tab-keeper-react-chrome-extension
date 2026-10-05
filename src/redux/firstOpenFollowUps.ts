import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import {
  closePinGuide,
  openFullViewOffer,
  openPinGuide,
  openSetup,
} from './slices/globalStateSlice';
import {
  shouldOfferFullView,
  shouldShowPinGuide,
  shouldShowSetup,
} from '../utils/functions/onboarding';
import { readToolbarPin } from '../utils/functions/toolbarPin';
import { isTabView } from '../utils/functions/viewMode';

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// KAN-7 §8. The full view's first-open chain: the pin guide when it applies,
// else setup when pending.
export const followInFullView =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const pin = await readToolbarPin();
    if (shouldShowPinGuide(getState().settingsDataState, pin)) {
      dispatch(openPinGuide());
      return;
    }
    if (shouldShowSetup(getState().settingsDataState)) dispatch(openSetup());
  };

// KAN-7 §8. The welcome (a new install) closed; its opening set setup pending.
// The popup offers the full view; the full view runs its own chain.
export const followWelcome =
  (
    { offerEnters }: { offerEnters: boolean } = { offerEnters: false }
  ): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    if (isTabView()) {
      await dispatch(followInFullView());
      return;
    }
    if (shouldOfferFullView(getState().settingsDataState)) {
      dispatch(openFullViewOffer({ enters: offerEnters }));
    }
  };

// KAN-7 §4. The guide closing, by a pin, Skip, ✕ or Esc; setup follows when pending.
export const leavePinGuide = (): Thunk<void> => (dispatch, getState) => {
  dispatch(closePinGuide());
  if (shouldShowSetup(getState().settingsDataState)) dispatch(openSetup());
};
