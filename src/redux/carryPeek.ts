// KAN-1006 (his yes). A carry resting on the folded saved session's card
// peeks the selected session, as resting on its row does (showSession), and
// the peek it opened folds back when that carry ends, dropped or cancelled.
// The stored fold is left alone, as a spring-opened window's is (KAN-379).
//
// Kept here, not in the card: the peek lays the page out without the card.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { currentCarry, subscribeCarry } from './carry';
import { showSession } from './showSession';
import { endSavedSessionPeek } from './slices/globalStateSlice';
import { runPaneMotion } from '../components/home/paneMotion';
import type { RootState } from './store';

type Thunk = ThunkAction<void, RootState, unknown, UnknownAction>;

// The carry's end, while a card peek waits for it: one at a time.
let stopWaiting: (() => void) | null = null;

export const peekForCarry = (): Thunk => (dispatch, getState) => {
  if (currentCarry() === null) return;
  const id = getState().tabContainerDataState.selectedTabGroupId;
  if (id === null) return;
  // Waited on whether or not the peek is on yet: a slide sets it later, when
  // the browser runs the transition's update.
  dispatch(showSession(id));
  stopWaiting?.();
  const unsubscribe = subscribeCarry(() => {
    if (currentCarry() !== null) return;
    stop();
    // The frame after, so a drop's commit is on the page the fold pictures.
    requestAnimationFrame(() => dispatch(foldBackCarryPeek()));
  });
  const stop = () => {
    unsubscribe();
    if (stopWaiting === stop) stopWaiting = null;
  };
  stopWaiting = stop;
};

// A peek still on ends; it slides only over a fold still stored. Unfolded
// meanwhile (pressed, or another page's settings), it ends at once, so it
// cannot hold a later fold open (KAN-280 O5).
const foldBackCarryPeek = (): Thunk => (dispatch, getState) => {
  const { globalState, settingsDataState } = getState();
  if (!globalState.isPeekingSavedSession) return;
  const end = () => dispatch(endSavedSessionPeek());
  if (settingsDataState.foldSavedSessionInTabView)
    runPaneMotion(end, 'saved', 'fold');
  else end();
};
