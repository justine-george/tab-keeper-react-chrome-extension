import { createAsyncThunk } from '@reduxjs/toolkit';

import { nextActionNumber } from './actionOrder';
import { closePlainToasts, showToast } from './slices/globalStateSlice';
import {
  liveStepDropped,
  liveStepRedone,
  liveStepUndone,
  pushLiveStep,
  redo,
  selectNextStep,
  undo,
} from './slices/undoRedoSlice';
import type { AppDispatch, RootState } from './store';
import { TOAST_MESSAGES } from '../utils/constants/common';
import { changedAnyPlace, runLiveStep } from '../utils/functions/openNowMoves';
import type { OpenNowDrop } from '../utils/functions/openNowMoves';

// KAN-744. What one press of undo or redo did: 'nothing' to step to, 'busy'
// (a live step, or an Open now sort or drag, is still moving tabs), 'saved' or
// 'live' (a step was taken), 'refused' (Chrome's tabs changed since, or the
// window is closed; dropped, with a toast), 'failed' (could not run; dropped,
// no toast).
export type StepRun =
  'nothing' | 'busy' | 'saved' | 'live' | 'refused' | 'failed';

// KAN-744 R19. One flag for undo and redo: a press while a live step runs is
// ignored, never queued.
let running = false;

// KAN-744 R19. Open now sorts and drags still moving tabs. Each becomes its
// step only once its moves end, so a press meanwhile is ignored too: it would
// undo the step below, and the new step would then clear that step's redo.
let movesInFlight = 0;

// Runs an Open now sort or drag's Chrome moves, counted as in flight until they end.
export async function whileMovingTabs<T>(move: () => Promise<T>): Promise<T> {
  movesInFlight += 1;
  try {
    return await move();
  } finally {
    movesInFlight -= 1;
  }
}

const REFUSED_TOAST = {
  undo: {
    sort: TOAST_MESSAGES.UNDO_REFUSED_SORT,
    move: TOAST_MESSAGES.UNDO_REFUSED_MOVE,
    windowClosed: TOAST_MESSAGES.UNDO_REFUSED_WINDOW_CLOSED,
  },
  redo: {
    sort: TOAST_MESSAGES.REDO_REFUSED_SORT,
    move: TOAST_MESSAGES.REDO_REFUSED_MOVE,
    windowClosed: TOAST_MESSAGES.REDO_REFUSED_WINDOW_CLOSED,
  },
};

type Direction = 'undo' | 'redo';

// How a press treats the plain toasts showing. The key and the menu close them
// (KAN-311 O8c), before any refused toast appears (R11); a toast's own Undo
// leaves them up (KAN-583, KAN-694). Omitted, the press closes them.
export interface StepPress {
  closesPlainToasts: boolean;
}

async function takeStep(
  direction: Direction,
  { closesPlainToasts }: StepPress,
  dispatch: AppDispatch,
  getState: () => RootState
): Promise<StepRun> {
  if (running || movesInFlight > 0) return 'busy';
  const state = getState();
  const next = selectNextStep(state, direction);
  if (next === null) return 'nothing';

  if (next === 'saved') {
    dispatch(direction === 'undo' ? undo() : redo());
    if (closesPlainToasts) dispatch(closePlainToasts());
    return 'saved';
  }

  // Read before awaiting: the reply names this step, whatever lands meanwhile.
  const { present, future } = state.undoRedo;
  const step = direction === 'undo' ? present.liveStep : future[0]?.liveStep;
  if (step === undefined) return 'nothing';

  running = true;
  try {
    if (closesPlainToasts) dispatch(closePlainToasts());
    const run = await runLiveStep(
      step.drop,
      direction,
      getState().globalState.hasTabGroupsPermission
    );
    if (run.outcome === 'done') {
      const reply = { id: step.id, drop: run.drop };
      dispatch(
        direction === 'undo' ? liveStepUndone(reply) : liveStepRedone(reply)
      );
      return 'live';
    }
    // KAN-744 R10-R12. A step that can't run leaves the history, so the next press reaches the one before.
    dispatch(liveStepDropped({ id: step.id }));
    if (run.outcome === 'couldNotRun') return 'failed';
    const kind =
      run.outcome === 'windowClosed'
        ? 'windowClosed'
        : step.drop.kind === 'sort' || step.drop.kind === 'groupSort'
          ? 'sort'
          : 'move';
    await dispatch(showToast({ toastText: REFUSED_TOAST[direction][kind] }));
    return 'refused';
  } finally {
    running = false;
  }
}

const CLOSES_PLAIN_TOASTS: StepPress = { closesPlainToasts: true };

// The thunk prefix is 'history/', never 'undoRedo/': the toast reducers match 'undoRedo/undo' exactly.
export const undoStep = createAsyncThunk<
  StepRun,
  StepPress | undefined,
  { state: RootState; dispatch: AppDispatch }
>('history/undoStep', (press, { dispatch, getState }) =>
  takeStep('undo', press ?? CLOSES_PLAIN_TOASTS, dispatch, getState)
);

export const redoStep = createAsyncThunk<
  StepRun,
  StepPress | undefined,
  { state: RootState; dispatch: AppDispatch }
>('history/redoStep', (press, { dispatch, getState }) =>
  takeStep('redo', press ?? CLOSES_PLAIN_TOASTS, dispatch, getState)
);

// KAN-744 R1. Keeps an Open now move as a step in the undo history, when it changed any place; returns its id.
export function keepLiveStep(
  dispatch: AppDispatch,
  drop: OpenNowDrop
): number | null {
  if (!changedAnyPlace(drop.moved)) return null;
  const id = nextActionNumber();
  dispatch(pushLiveStep({ id, drop }));
  return id;
}
