import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { closeSetup, openPinGuide, openSetup } from './slices/globalStateSlice';
import { requestEnding } from './onboardingEnding';
import { finishSetup } from './slices/settingsDataStateSlice';
import {
  shouldShowPinGuide,
  shouldShowSetup,
} from '../utils/functions/onboarding';
import { readToolbarPin } from '../utils/functions/toolbarPin';

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// §3. The pin guide, only while unpinned here and not dismissed.
export const offerPinGuide =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const pin = await readToolbarPin();
    if (shouldShowPinGuide(getState().settingsDataState, pin)) {
      dispatch(openPinGuide());
    }
  };

// §3. Setup when pending, a replay after a Help tour (KAN-879); else straight to the pin guide.
export const followWithSetup =
  (isReplay = false): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    if (shouldShowSetup(getState().settingsDataState)) {
      dispatch(openSetup({ isReplay }));
      return;
    }
    await dispatch(offerPinGuide());
  };

// §3. Done, Skip setup, ✕ or Esc ends setup for good; the pin guide follows unless Help opened it.
export const leaveSetup =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const { doesSetupLeadToPinGuide: leadsToPinGuide, isSetupReplay } =
      getState().globalState;
    dispatch(finishSetup());
    dispatch(closeSetup());
    if (leadsToPinGuide) await dispatch(offerPinGuide());
    // KAN-879. After the pin guide has opened or not, so the ending waits behind it.
    if (!isSetupReplay) dispatch(requestEnding());
  };
