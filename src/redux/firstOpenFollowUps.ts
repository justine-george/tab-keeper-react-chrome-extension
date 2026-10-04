import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { openFullViewOffer } from './slices/globalStateSlice';
import { beginSetup } from './slices/settingsDataStateSlice';
import { shouldOfferFullView } from '../utils/functions/onboarding';
import { isTabView } from '../utils/functions/viewMode';

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// KAN-7 §8. The welcome (a new install) closed, by any answer: setup is now
// pending, and the popup offers the full view. Not in the full view itself.
export const followWelcome = (): Thunk<void> => (dispatch, getState) => {
  dispatch(beginSetup());
  if (isTabView()) return;
  if (shouldOfferFullView(getState().settingsDataState)) {
    dispatch(openFullViewOffer());
  }
};
