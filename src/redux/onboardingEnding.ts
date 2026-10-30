import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { thisView } from './firstRun';
import { setEndingCard } from './slices/globalStateSlice';
import { markEndingSeen } from './slices/settingsDataStateSlice';

// KAN-879. The onboarding ending: asked for once per view, shown when nothing covers it.

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

const isEndingSeenHere = (state: RootState): boolean =>
  thisView() === 'full'
    ? state.settingsDataState.isFullViewEndingSeen
    : state.settingsDataState.isPopupEndingSeen;

// Not once this view has shown it, nor while one is waiting or on screen.
export const requestEnding = (): Thunk<void> => (dispatch, getState) => {
  const state = getState();
  if (isEndingSeenHere(state) || state.globalState.endingCard !== null) return;
  dispatch(setEndingCard('pending'));
};

// The card opens: seen from now, so a page closed on it never brings it back.
export const showEnding = (): Thunk<void> => (dispatch, getState) => {
  const state = getState();
  if (state.globalState.endingCard !== 'pending') return;
  // Another page of this view showed it while it waited here.
  if (isEndingSeenHere(state)) {
    dispatch(setEndingCard(null));
    return;
  }
  dispatch(setEndingCard('shown'));
  dispatch(markEndingSeen(thisView()));
};

// Got it or Esc.
export const closeEnding = (): Thunk<void> => (dispatch) => {
  dispatch(setEndingCard(null));
};
