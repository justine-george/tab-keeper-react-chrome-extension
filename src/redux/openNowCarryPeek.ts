// KAN-1008 (his pick B). Wide, a saved carry resting on folded Currently
// open's rail shows it beside the saved session, as its press does (KAN-1002),
// but for the carry only: the stored fold is left alone, and the carry's end,
// dropped or cancelled, folds it back.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { currentCarry, noteCarryOverOpenNow, subscribeCarry } from './carry';
import { endOpenNowPeek, peekOpenNow } from './slices/globalStateSlice';
import { runPaneMotion } from '../components/home/paneMotion';
import type { RootState } from './store';

type Thunk = ThunkAction<void, RootState, unknown, UnknownAction>;

// The carry's end, while a peek waits for it: one at a time.
let stopWaiting: (() => void) | null = null;

export const peekOpenNowForCarry = (): Thunk => (dispatch) => {
  if (currentCarry() === null) return;
  // As the drawer's spring: the carry is in Currently open (KAN-820 F2).
  noteCarryOverOpenNow(true);
  // The browser runs a slide's update later: a carry already ended by then peeks nothing.
  runPaneMotion(
    () => {
      if (currentCarry() !== null) dispatch(peekOpenNow());
    },
    'openNow',
    'unfold'
  );
  stopWaiting?.();
  const unsubscribe = subscribeCarry(() => {
    if (currentCarry() !== null) return;
    stop();
    // The frame after, so a drop's commit is on the page the fold pictures.
    requestAnimationFrame(() => dispatch(foldBackOpenNowPeek()));
  });
  const stop = () => {
    unsubscribe();
    if (stopWaiting === stop) stopWaiting = null;
  };
  stopWaiting = stop;
};

// A peek still on ends; it slides only over a fold still stored, else it ends at once.
const foldBackOpenNowPeek = (): Thunk => (dispatch, getState) => {
  const { globalState, settingsDataState } = getState();
  if (!globalState.isPeekingOpenNow) return;
  const end = () => dispatch(endOpenNowPeek());
  if (settingsDataState.foldOpenNowInTabView)
    runPaneMotion(end, 'openNow', 'fold');
  else end();
};
