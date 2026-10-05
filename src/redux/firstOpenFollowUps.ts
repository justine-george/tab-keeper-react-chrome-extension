import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { closeSetup, openPinGuide, openSetup } from './slices/globalStateSlice';
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

// §3. Setup when pending; else straight to the pin guide.
export const followWithSetup =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    if (shouldShowSetup(getState().settingsDataState)) {
      dispatch(openSetup());
      return;
    }
    await dispatch(offerPinGuide());
  };

// §3. Done, Skip setup, ✕ or Esc ends setup for good; the pin guide follows unless Help opened it.
export const leaveSetup =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const leadsToPinGuide = getState().globalState.doesSetupLeadToPinGuide;
    dispatch(finishSetup());
    dispatch(closeSetup());
    if (leadsToPinGuide) await dispatch(offerPinGuide());
  };
