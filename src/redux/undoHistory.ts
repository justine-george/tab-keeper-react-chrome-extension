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
import {
  changedAnyPlace,
  isSortKind,
  runLiveStep,
} from '../utils/functions/openNowMoves';
import type { LiveRun, OpenNowDrop } from '../utils/functions/openNowMoves';
import { isOpenedCopy } from '../utils/functions/openedCopy';
import { runOpenedCopy } from '../utils/functions/runOpenedCopy';
import type { LiveDrop, OpenedCopy } from '../utils/functions/openedCopy';

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

// KAN-893. Drops into Currently open still waiting to keep their step (a New
// window drop's worker answers late). A press meanwhile is ignored too, but
// Open now's list does not wait for these, as it does for moves.
let stepsInFlight = 0;

export async function whileKeepingStep<T>(keep: () => Promise<T>): Promise<T> {
  stepsInFlight += 1;
  try {
    return await keep();
  } finally {
    stepsInFlight -= 1;
  }
}

// KAN-835. Told each time an Open now sort or drag's moves end.
const movesEndedListeners = new Set<() => void>();

export function onTabMovesEnded(listener: () => void): () => void {
  movesEndedListeners.add(listener);
  return () => {
    movesEndedListeners.delete(listener);
  };
}

// KAN-486. Whether any are in flight: Open now's list waits, so a pair's temporary group is never read.
export const tabMovesInFlight = (): boolean => movesInFlight > 0;

// Runs an Open now sort or drag's Chrome moves, counted as in flight until they end.
export async function whileMovingTabs<T>(move: () => Promise<T>): Promise<T> {
  movesInFlight += 1;
  try {
    return await move();
  } finally {
    movesInFlight -= 1;
    for (const listener of movesEndedListeners) listener();
  }
}

const REFUSED_TOAST = {
  undo: {
    sort: TOAST_MESSAGES.UNDO_REFUSED_SORT,
    move: TOAST_MESSAGES.UNDO_REFUSED_MOVE,
    windowClosed: TOAST_MESSAGES.UNDO_REFUSED_WINDOW_CLOSED,
    // KAN-893. An undo refuses when the tabs changed; a redo only when the window closed.
    drop: TOAST_MESSAGES.UNDO_REFUSED_DROP,
  },
  redo: {
    sort: TOAST_MESSAGES.REDO_REFUSED_SORT,
    move: TOAST_MESSAGES.REDO_REFUSED_MOVE,
    windowClosed: TOAST_MESSAGES.REDO_REFUSED_WINDOW_CLOSED,
    drop: TOAST_MESSAGES.REDO_REFUSED_DROP_WINDOW_CLOSED,
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
  if (running || movesInFlight > 0 || stepsInFlight > 0) return 'busy';
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
    const { drop } = step;
    const hasTabGroups = getState().globalState.hasTabGroupsPermission;
    const run = await whileMovingTabs<LiveRun<LiveDrop>>(() =>
      isOpenedCopy(drop)
        ? runOpenedCopy(drop, direction, {
            hasTabGroups,
            pinTabKeeper: getState().settingsDataState.pinTabKeeperInNewWindows,
          })
        : runLiveStep(
            drop,
            direction,
            hasTabGroups,
            // KAN-949. A redo that makes a closed window again follows the setting now.
            getState().settingsDataState.pinTabKeeperInNewWindows
          )
    );
    if (run.outcome === 'done') {
      const reply = { id: step.id, drop: run.drop };
      dispatch(
        direction === 'undo'
          ? liveStepUndone(reply)
          : liveStepRedone({ ...reply, renamed: run.renamed })
      );
      return 'live';
    }
    // KAN-744 R10-R12. A step that can't run leaves the history, so the next press reaches the one before.
    dispatch(liveStepDropped({ id: step.id }));
    if (run.outcome === 'couldNotRun') return 'failed';
    const kind = isOpenedCopy(drop)
      ? 'drop'
      : run.outcome === 'windowClosed'
        ? 'windowClosed'
        : isSortKind(drop.kind)
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

// KAN-744 R1. Keeps an Open now move as a step in the undo history, when it changed any place, or ended a split, which moves nothing (KAN-942); returns its id.
export function keepLiveStep(
  dispatch: AppDispatch,
  drop: OpenNowDrop
): number | null {
  if (drop.kind !== 'endSplit' && !changedAnyPlace(drop.moved)) return null;
  const id = nextActionNumber();
  dispatch(pushLiveStep({ id, drop }));
  return id;
}

// KAN-893. Keeps a drop into Currently open as a step, when it opened any tab; returns its id.
export function keepOpenedStep(
  dispatch: (action: ReturnType<typeof pushLiveStep>) => unknown,
  step: OpenedCopy
): number | null {
  if (step.tabs.length === 0) return null;
  const id = nextActionNumber();
  dispatch(pushLiveStep({ id, drop: step }));
  return id;
}
