import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { thisView } from './firstRun';
import { setEndingCard } from './slices/globalStateSlice';
import { markEndingSeen } from './slices/settingsDataStateSlice';
import { hasPageCover } from './pageCovers';
import { isSearchActive } from '../utils/functions/local';
import {
  endingTarget,
  type EndingTarget,
} from '../utils/functions/onboardingEnding';

// KAN-879. The onboarding ending: asked for once per view, shown when nothing covers it.

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

const isEndingSeenHere = (state: RootState): boolean =>
  thisView() === 'full'
    ? state.settingsDataState.isFullViewEndingSeen
    : state.settingsDataState.isPopupEndingSeen;

// Where the card could be seen: no cover, not on Settings, not during a search.
export const isEndingVisibleHere = (state: RootState): boolean =>
  !hasPageCover(state) &&
  !state.globalState.isSettingsPage &&
  !isSearchActive(state.globalState.searchInputText);

export const selectIsEndingShown = (state: RootState): boolean =>
  state.globalState.endingCard === 'shown' && isEndingVisibleHere(state);

export const selectEndingTarget = (state: RootState): EndingTarget =>
  endingTarget(
    state.settingsDataState.firstRun,
    state.tabContainerDataState.tabGroups
  );

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
