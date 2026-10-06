import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

import type { RootState } from './store';
import { showSession } from './showSession';
import { selectIsSavedSessionFolded } from './savedSessionFold';
import {
  closeFullViewCallout,
  closeSettingsPage,
  expandWindow,
  setSearchInputText,
  tourStartedHere,
  tourStoppedHere,
} from './slices/globalStateSlice';
import {
  clearSampleTour,
  recordSampleTour,
  setSampleTourStep,
} from './slices/settingsDataStateSlice';
import {
  deleteTabContainer,
  deleteTabContainerInternal,
  deleteTabContainerWithoutHistory,
  saveToTabContainerInternal,
  type tabContainerData,
} from './slices/tabContainerDataStateSlice';
import {
  buildSampleSession,
  holdsOnlySampleTabs,
  type SampleNames,
} from '../utils/functions/sampleSession';
import { nextTourStep, type SampleTour } from '../utils/functions/sampleTour';
import { holdTourLock, tourLockState } from '../utils/functions/tourLock';
import {
  isSearchActive,
  selectVisibleTabGroups,
} from '../utils/functions/local';
import { storedSessionCount } from '../utils/functions/storedSessions';
import { isTabView } from '../utils/functions/viewMode';

// KAN-413. Starting, moving on and ending the sample tour.

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// What the open-time check found: <html data-tour-check> reports it.
export type TourCheck =
  | 'none'
  | 'unloaded'
  | 'here'
  | 'elsewhere'
  | 'unknown'
  | 'ended'
  | 'kept';

// Module state, as dragHold's is: a lock's release is no application data.
let releaseLock: (() => void) | null = null;
let starting: Promise<void> | null = null;

export const selectTourHere = (state: RootState): SampleTour | null => {
  const tour = state.settingsDataState.sampleTour;
  return tour !== null && tour.sampleId === state.globalState.tourSampleIdHere
    ? tour
    : null;
};

// Whether this page shows a guided run (KAN-394 F18).
export const selectIsGuidedRunHere = (state: RootState): boolean =>
  selectTourHere(state) !== null;

export const selectTourSample = (
  state: RootState
): tabContainerData | undefined => {
  const tour = selectTourHere(state);
  return tour === null
    ? undefined
    : state.tabContainerDataState.tabGroups.find(
        (g) => g.tabGroupId === tour.sampleId
      );
};

// The detail pane draws the sample with Open and ⋮: no fold, and no search, which hides both.
export const selectIsTourSampleShown = (state: RootState): boolean => {
  const tour = selectTourHere(state);
  if (tour === null) return false;
  if (isSearchActive(state.globalState.searchInputText)) return false;
  if (isTabView() && selectIsSavedSessionFolded(state)) return false;
  const shown = selectVisibleTabGroups(
    state.tabContainerDataState.tabGroups,
    state.globalState.searchInputText,
    state.globalState.hasTabGroupsPermission
  )[0];
  return shown?.tabGroupId === tour.sampleId;
};

const hasSession = (state: RootState, id: string): boolean =>
  state.tabContainerDataState.tabGroups.some((g) => g.tabGroupId === id);

const stopTourHere = (): Thunk<void> => (dispatch, getState) => {
  releaseLock?.();
  releaseLock = null;
  if (getState().globalState.tourSampleIdHere !== null) {
    dispatch(tourStoppedHere());
  }
};

// removeSample says whether ⌘Z can bring the sample back.
const endTour =
  (removeSample: (tabGroupId: string) => UnknownAction): Thunk<void> =>
  (dispatch, getState) => {
    const state = getState();
    const tour = state.settingsDataState.sampleTour;
    if (tour !== null) {
      // Never against the placeholder: a delete there writes an empty list to disk.
      if (state.globalState.holdsPlaceholderSessions) return;
      if (hasSession(state, tour.sampleId)) {
        dispatch(removeSample(tour.sampleId));
      }
      dispatch(clearSampleTour());
    }
    dispatch(stopTourHere());
  };

// Skip, Finish, the step-5 delete, Esc: an undoable, synced delete with no toast.
export const endSampleTour = (): Thunk<void> =>
  endTour(deleteTabContainerInternal);

// A second press while the first waits for its lock joins it.
export const startSampleTour =
  (names: SampleNames): Thunk<Promise<void>> =>
  (dispatch, getState) => {
    starting ??= (async () => {
      // Sessions still to load: a save now would write over them on disk.
      if (
        getState().globalState.holdsPlaceholderSessions &&
        storedSessionCount() > 0
      ) {
        return;
      }
      dispatch(endSampleTour());
      dispatch(closeSettingsPage());
      dispatch(setSearchInputText(''));
      dispatch(closeFullViewCallout());
      const sample = buildSampleSession(names, new Date(), () => uuidv4());
      // Held before anything is written: no page ever sees a record no page holds.
      releaseLock = await holdTourLock(sample.tabGroupId);
      dispatch(saveToTabContainerInternal(sample));
      dispatch(showSession(sample.tabGroupId));
      dispatch(
        recordSampleTour({
          sampleId: sample.tabGroupId,
          step: 1,
          view: isTabView() ? 'full' : 'popup',
        })
      );
      dispatch(tourStartedHere(sample.tabGroupId));
    })().finally(() => {
      starting = null;
    });
    return starting;
  };

// Next; step 5 has none.
export const advanceSampleTour = (): Thunk<void> => (dispatch, getState) => {
  const tour = selectTourHere(getState());
  if (tour === null) return;
  const next = nextTourStep(tour.step);
  if (next !== null) dispatch(setSampleTourStep(next));
};

// Step 4 points at the first tab, so its window opens; nothing is reselected.
export const unfoldStepFourWindow = (): Thunk<void> => (dispatch, getState) => {
  const tour = selectTourHere(getState());
  const first = selectTourSample(getState())?.windows[0];
  if (tour === null || tour.step !== 4 || first === undefined) return;
  dispatch(
    expandWindow({ tabGroupId: tour.sampleId, windowId: first.windowId })
  );
};

// Ended another way: an undo, a delete or another page's write took the sample away, or a tour started elsewhere replaced the record.
export const reconcileTourHere = (): Thunk<void> => (dispatch, getState) => {
  const state = getState();
  const here = state.globalState.tourSampleIdHere;
  if (here === null || state.globalState.holdsPlaceholderSessions) return;
  if (state.settingsDataState.sampleTour?.sampleId !== here) {
    dispatch(stopTourHere());
    return;
  }
  if (!hasSession(state, here)) {
    dispatch(clearSampleTour());
    dispatch(stopTourHere());
  }
};

// After the first load: no page holds the lock, so the tour is over.
export const endTourIfInterrupted =
  (): Thunk<Promise<TourCheck>> => async (dispatch, getState) => {
    const tour = getState().settingsDataState.sampleTour;
    if (tour === null) return 'none';
    if (tour.sampleId === getState().globalState.tourSampleIdHere) {
      return 'here';
    }
    // Before the first load the sample cannot be told from an empty list.
    if (getState().globalState.holdsPlaceholderSessions) return 'unloaded';
    const lock = await tourLockState(tour.sampleId);
    if (lock === 'held') return 'elsewhere';
    if (lock === 'unknown') return 'unknown';
    if (getState().settingsDataState.sampleTour?.sampleId !== tour.sampleId) {
      return 'none';
    }
    // A tab carried in is the user's, and this end has no undo: the sample stays as an ordinary session.
    const sample = getState().tabContainerDataState.tabGroups.find(
      (g) => g.tabGroupId === tour.sampleId
    );
    if (sample !== undefined && !holdsOnlySampleTabs(sample)) {
      dispatch(clearSampleTour());
      return 'kept';
    }
    // The user never deleted this sample, so ⌘Z must not bring it back.
    dispatch(endTour(deleteTabContainerWithoutHistory));
    return 'ended';
  };

// HeroContainerRight's Delete session: on the sample at step 5 it is the tour's end.
export const deleteSessionFromMenu =
  (tabGroupId: string): Thunk<void> =>
  (dispatch, getState) => {
    const tour = selectTourHere(getState());
    if (tour !== null && tour.step === 5 && tour.sampleId === tabGroupId) {
      dispatch(endSampleTour());
      return;
    }
    void dispatch(deleteTabContainer(tabGroupId));
  };
