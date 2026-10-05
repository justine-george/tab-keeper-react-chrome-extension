import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

import type { AppDispatch, RootState } from './store';
import { followWithSetup } from './firstOpenFollowUps';
import { showSession } from './showSession';
import { selectIsSavedSessionFolded } from './savedSessionFold';
import {
  closeFullViewCallout,
  closeSettingsPage,
  openCloudConsentModal,
  runShownHere,
  runStoppedHere,
  setRunSaveCard,
  setRunSaveEcho,
  setSearchInputText,
} from './slices/globalStateSlice';
import {
  beginSetup,
  countWelcomeShow,
  endFirstRun,
  markFullViewCalloutSeen,
  recordFirstRun,
  setFirstRunSession,
  setFirstRunStep,
} from './slices/settingsDataStateSlice';
import {
  deleteTabContainerInternal,
  saveToTabContainerInternal,
  type tabContainerData,
} from './slices/tabContainerDataStateSlice';
import {
  buildSampleSession,
  isSampleSession,
  type SampleNames,
} from '../utils/functions/sampleSession';
import {
  latestSession,
  needsSession,
  nextRunStep,
  previousRunStep,
  runStepKind,
  type FirstRun,
  type RunAtOpen,
  type RunEnding,
  type RunStep,
  type RunView,
} from '../utils/functions/firstRun';
import { holdTourLock, RUN_LOCK } from '../utils/functions/tourLock';
import {
  isSearchActive,
  selectVisibleTabGroups,
} from '../utils/functions/local';
import { storedSessionCount } from '../utils/functions/storedSessions';
import { hasTabsToSave } from '../utils/functions/capture';
import { isTabView } from '../utils/functions/viewMode';

// The guided first run in this page: starting it, moving it, ending it.

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// A lock's release is no application data; one per store, so a test can stand up two pages.
const locks = new WeakMap<() => RootState, Promise<() => void>>();

export const thisView = (): RunView => (isTabView() ? 'full' : 'popup');

// The record, while it runs in this view and this page shows it.
export const selectRunHere = (state: RootState): FirstRun | null => {
  const run = state.settingsDataState.firstRun;
  return state.globalState.isRunHere &&
    run !== null &&
    run.ended === null &&
    run.view === thisView()
    ? run
    : null;
};

export const selectRunSession = (
  state: RootState
): tabContainerData | undefined => {
  const id = selectRunHere(state)?.sessionId ?? null;
  return id === null
    ? undefined
    : state.tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id);
};

// R3. Settings or a search hide every card; another session or the fold hides a session step's.
export const selectIsRunCardShown = (state: RootState): boolean => {
  const run = selectRunHere(state);
  if (run === null || state.globalState.isSettingsPage) return false;
  if (isSearchActive(state.globalState.searchInputText)) return false;
  const kind = runStepKind(run.view, run.step);
  if (kind === null || !needsSession(kind)) return true;
  if (isTabView() && selectIsSavedSessionFolded(state)) return false;
  const shown = selectVisibleTabGroups(
    state.tabContainerDataState.tabGroups,
    state.globalState.searchInputText,
    state.globalState.hasTabGroupsPermission
  )[0];
  return run.sessionId !== null && shown?.tabGroupId === run.sessionId;
};

const ROW_KINDS = ['row', 'open', 'switch', 'delete'] as const;

// Spec delta 2: the row the run points at is drawn engaged, so its Open, Switch and Delete show.
export const selectRunEngagedRowId = (state: RootState): string | null => {
  const run = selectRunHere(state);
  if (run === null || !selectIsRunCardShown(state)) return null;
  const kind = runStepKind(run.view, run.step);
  return ROW_KINDS.some((k) => k === kind) ? run.sessionId : null;
};

// Hard rule 2: while the Delete step shows, the run's Delete explains only.
export const selectRunHoldsDelete = (
  state: RootState,
  tabGroupId: string
): boolean => {
  const run = selectRunHere(state);
  return (
    run !== null &&
    run.sessionId === tabGroupId &&
    runStepKind(run.view, run.step) === 'delete'
  );
};

// The row button the current step lights, if it is one the run also blocks.
export const selectRunLitRowButton = (
  state: RootState
): 'open' | 'switch' | null => {
  const run = selectRunHere(state);
  const kind = run === null ? null : runStepKind(run.view, run.step);
  return kind === 'open' || kind === 'switch' ? kind : null;
};

const hasSession = (state: RootState, id: string): boolean =>
  state.tabContainerDataState.tabGroups.some((g) => g.tabGroupId === id);

const isLoading = (state: RootState): boolean =>
  state.globalState.holdsPlaceholderSessions && storedSessionCount() > 0;

const stopRunHere = (): Thunk<void> => (dispatch, getState) => {
  const held = locks.get(getState);
  locks.delete(getState);
  void held?.then((release) => release());
  if (getState().globalState.isRunHere) dispatch(runStoppedHere());
};

// A3. Taken with steal: a newer page's start makes this page stand down.
const holdLock = (): Thunk<Promise<() => void>> => (dispatch, getState) => {
  const held = locks.get(getState);
  if (held !== undefined) return held;
  const taken = holdTourLock(RUN_LOCK, () => {
    locks.delete(getState);
    dispatch(runStoppedHere());
  });
  locks.set(getState, taken);
  return taken;
};

// The open-time resume shows the run here without writing it.
export const resumeRunHere = (): Thunk<Promise<void>> => async (dispatch) => {
  await dispatch(holdLock());
  dispatch(runShownHere());
};

// Lets the lock go and stops showing the run, leaving the record as it is; resolves once let go.
export const leaveRunHere =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const held = locks.get(getState);
    locks.delete(getState);
    if (getState().globalState.isRunHere) dispatch(runStoppedHere());
    const release = await held;
    release?.();
  };

// Every start writes a new record; it never deletes the run it replaces (A4).
export const startRun =
  (run: FirstRun): Thunk<Promise<void>> =>
  async (dispatch) => {
    dispatch(closeSettingsPage());
    dispatch(setSearchInputText(''));
    dispatch(closeFullViewCallout());
    dispatch(setRunSaveCard(null));
    // Held before the record is written: no page sees a record no page holds.
    await dispatch(holdLock());
    dispatch(recordFirstRun(run));
    dispatch(runShownHere());
  };

// Q7: the popup's welcome is the run's step 0, held by this page while it shows.
export const showWelcome =
  (run: FirstRun | null): Thunk<Promise<void>> =>
  async (dispatch) => {
    if (run === null) await dispatch(resumeRunHere());
    else await dispatch(startRun(run));
    dispatch(openCloudConsentModal({ variant: 'welcome' }));
  };

// What an open's decision opens; null when it opens nothing.
export function runOpener(
  decision: RunAtOpen,
  dispatch: AppDispatch
): (() => void) | null {
  switch (decision.action) {
    case 'nothing':
      return null;
    case 'endUnanswered':
      dispatch(endFirstRun('unanswered'));
      return null;
    case 'resume':
      return () => void dispatch(resumeRunHere());
    case 'reshowWelcome':
      return () => {
        dispatch(countWelcomeShow());
        void dispatch(showWelcome(null));
      };
    case 'start':
      return () => {
        // Q8: setup begins; the consent answer they gave is never touched.
        if (decision.beginsSetup) dispatch(beginSetup());
        void dispatch(
          decision.run.view === 'popup'
            ? showWelcome(decision.run)
            : startRun(decision.run)
        );
      };
  }
}

export const goToRunStep =
  (step: RunStep): Thunk<void> =>
  (dispatch, getState) => {
    if (selectRunHere(getState()) !== null) dispatch(setFirstRunStep(step));
  };

// R10, Q3, A5. Decided once per page, for the save step at `step`, before or once it shows.
const decideSaveCard =
  (step: RunStep): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const run = selectRunHere(state);
    if (run === null || runStepKind(run.view, step) !== 'save') return;
    if (state.globalState.runSaveCard !== null || isLoading(state)) return;
    if (run.sessionId !== null) {
      dispatch(setRunSaveCard(run.view === 'full' ? 'sessions' : 'save'));
      return;
    }
    const latest =
      run.view === 'full'
        ? latestSession(state.tabContainerDataState.tabGroups)
        : undefined;
    if (latest !== undefined) {
      dispatch(setFirstRunSession(latest.tabGroupId));
      dispatch(setRunSaveCard('sessions'));
      return;
    }
    // A failed query falls back to the card whose way on needs no chrome call.
    const hasTabs = await hasTabsToSave().catch(() => false);
    const now = getState();
    if (
      selectRunHere(now)?.step === run.step &&
      now.globalState.runSaveCard === null
    ) {
      dispatch(setRunSaveCard(hasTabs ? 'save' : 'nothingToSave'));
    }
  };

// The resumed or reloaded save step, decided once it shows.
export const beginSaveStep =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const run = selectRunHere(getState());
    if (run !== null) await dispatch(decideSaveCard(run.step));
  };

// KAN-436. Onto an undecided save step, the card is decided first, so the card glides there and is never drawn anew.
const moveRun =
  (to: (run: FirstRun) => RunStep | null): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    const run = selectRunHere(getState());
    const target = run === null ? null : to(run);
    if (run === null || target === null) return;
    if (
      runStepKind(run.view, target) === 'save' &&
      getState().globalState.runSaveCard === null
    ) {
      await dispatch(decideSaveCard(target));
      // A second press, a Back or a lost lock in the meantime has moved on.
      if (selectRunHere(getState())?.step !== run.step) return;
    }
    dispatch(setFirstRunStep(target));
  };

export const advanceRun = (): Thunk<Promise<void>> =>
  moveRun((run) => nextRunStep(run.view, run.step));

export const stepRunBack = (): Thunk<Promise<void>> =>
  moveRun((run) => previousRunStep(run.view, run.step));

// §8, Q3: before the run's save, the save step's field shows the name an empty save would use.
export const selectRunAwaitsSave = (state: RootState): boolean => {
  const run = selectRunHere(state);
  const card = state.globalState.runSaveCard;
  return (
    run !== null &&
    run.sessionId === null &&
    runStepKind(run.view, run.step) === 'save' &&
    (card === 'save' || card === 'nothingToSave')
  );
};

// The run's own save, once: a second save is an ordinary one (R6).
export const takeRunSave =
  (tabGroupId: string): Thunk<void> =>
  (dispatch, getState) => {
    const run = selectRunHere(getState());
    if (run === null || run.sessionId !== null) return;
    if (runStepKind(run.view, run.step) !== 'save') return;
    dispatch(setFirstRunSession(tabGroupId));
    dispatch(showSession(tabGroupId));
    dispatch(setRunSaveEcho(tabGroupId));
    void dispatch(advanceRun());
  };

// Q2, Q3. The sample becomes the run's session; R9 removes it at the end.
export const takeExampleForRun =
  (names: SampleNames): Thunk<void> =>
  (dispatch, getState) => {
    const state = getState();
    const run = selectRunHere(state);
    if (run === null || runStepKind(run.view, run.step) !== 'save') return;
    if (run.sessionId !== null) {
      void dispatch(advanceRun());
      return;
    }
    // Sessions still to load: a save now would write over them on disk.
    if (isLoading(state)) return;
    const sample = buildSampleSession(names, new Date(), () => uuidv4());
    dispatch(saveToTabContainerInternal(sample));
    dispatch(setFirstRunSession(sample.tabGroupId));
    dispatch(showSession(sample.tabGroupId));
    void dispatch(advanceRun());
  };

// R9: only a sample is removed, as an ordinary, undoable, synced delete with no toast.
export const endRun =
  (ending: RunEnding): Thunk<void> =>
  (dispatch, getState) => {
    const state = getState();
    const run = selectRunHere(state);
    if (run !== null) {
      const id = run.sessionId;
      if (
        id !== null &&
        isSampleSession(id) &&
        !state.globalState.holdsPlaceholderSessions &&
        hasSession(state, id)
      ) {
        dispatch(deleteTabContainerInternal(id));
      }
      dispatch(endFirstRun(ending));
      // Q6. The popup run has just pointed at ⤢; the callout would say it again.
      if (run.view === 'popup') dispatch(markFullViewCalloutSeen());
    }
    dispatch(stopRunHere());
  };

// The last step done; a full-view run goes on to setup (begun for an upgrader), then the pin guide.
export const finishRunHere =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    const run = selectRunHere(getState());
    dispatch(endRun('finished'));
    if (run === null || run.view !== 'full') return;
    dispatch(beginSetup());
    await dispatch(followWithSetup());
  };

// Pins Tab Keeper's own tab, only when pressed; already pinned or a refusal pins nothing, and the run ends either way.
export const pinThisTab = (): Thunk<Promise<void>> => async (dispatch) => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined && tab.pinned !== true) {
      await chrome.tabs.update(tab.id, { pinned: true });
    }
  } catch (error) {
    console.warn('Could not pin the Tab Keeper tab:', error);
  }
  await dispatch(finishRunHere());
};

// Popup step 7: ⤢ ends the run before the new tab can end this popup.
export const endRunAtFullViewButton =
  (): Thunk<void> => (dispatch, getState) => {
    const run = selectRunHere(getState());
    if (run !== null && runStepKind(run.view, run.step) === 'fullView') {
      dispatch(endRun('finished'));
    }
  };

// R2: the run's session gone ends it quietly; a record ended or replaced elsewhere stops it here.
export const reconcileRunHere = (): Thunk<void> => (dispatch, getState) => {
  const state = getState();
  if (
    !state.globalState.isRunHere ||
    state.globalState.holdsPlaceholderSessions
  ) {
    return;
  }
  const run = selectRunHere(state);
  if (run === null) {
    dispatch(stopRunHere());
    return;
  }
  if (run.sessionId !== null && !hasSession(state, run.sessionId)) {
    dispatch(endRun('sessionGone'));
  }
};
