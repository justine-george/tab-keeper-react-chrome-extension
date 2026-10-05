import { STAND_DOWN, type DialogEntry } from '../utils/functions/dialogQueue';
import type { AppDispatch, RootState } from './store';
import {
  openCloudConsentModal,
  openFullViewCallout,
  openPinGuide,
  openRateAndReviewModal,
  openSetup,
  openTabGroupsPrompt,
} from './slices/globalStateSlice';
import {
  beginSetup,
  declineCloudConsent,
  type SettingsData,
} from './slices/settingsDataStateSlice';
import { isValidDate } from '../utils/functions/local';
import {
  shouldShowFullViewCallout,
  shouldShowPinGuide,
  shouldShowSetup,
} from '../utils/functions/onboarding';
import { showWhenQuiet } from './quietCards';
import { runOpener, showWelcome, startRun } from './firstRun';
import { newRun, runAtOpen, type RunCheck } from '../utils/functions/firstRun';
import { RUN_LOCK, tourLockState } from '../utils/functions/tourLock';
import { shouldAskForReview } from '../utils/functions/reviewAsk';
import { readToolbarPin } from '../utils/functions/toolbarPin';
import { shouldOfferTabGroups } from '../utils/functions/tabGroupsOffer';

export type Surface = 'popup' | 'full';

// <html data-run-check>: what this open did about the run, the e2e barrier.
const reportRunCheck = (check: RunCheck): void => {
  document.documentElement.dataset.runCheck = check;
};

export interface FirstOpen {
  dispatch: AppDispatch;
  // settingsData as stored before this open wrote anything.
  storedAtOpen: Partial<SettingsData>;
  // Saved sessions on disk at this open; the store has not loaded them yet.
  storedSessions: number;
  getState: () => RootState;
}

/**
 * KAN-7 §8. The dialogs a surface may open when it mounts, in priority order.
 * openFirstDialog opens the first that says yes; the rest stand down until
 * the next open.
 */
export function firstOpenDialogs(
  surface: Surface,
  open: FirstOpen
): DialogEntry[] {
  const { dispatch, storedAtOpen } = open;

  // KAN-259. Asked once, before the others. An existing user (sessions on
  // disk, or a past sync) who already turned Auto Sync off is recorded as
  // declined without asking: they answered, in the only way there used to be.
  const cloudConsent: DialogEntry = {
    id: 'cloudConsent',
    decide: () => {
      if (
        storedAtOpen.cloudConsent === 'granted' ||
        storedAtOpen.cloudConsent === 'declined'
      ) {
        return null;
      }
      // KAN-410. Not the install date: a 1.9.x welcome closed unanswered stamped one with nothing synced.
      const isExisting =
        open.storedSessions > 0 || isValidDate(storedAtOpen.lastSyncedTime);
      if (isExisting && storedAtOpen.isAutoSync === false) {
        dispatch(declineCloudConsent());
        return null;
      }
      if (isExisting) {
        return () => dispatch(openCloudConsentModal({ variant: 'existing' }));
      }
      // KAN-410 and Q7: recorded as it opens, the welcome being the popup run's step 0.
      reportRunCheck('started');
      return () => {
        dispatch(declineCloudConsent());
        dispatch(beginSetup());
        // The full view greets a new install with the run's own Hello, never the welcome.
        void dispatch(
          surface === 'popup'
            ? showWelcome(newRun('popup', 0))
            : startRun(newRun('full', 0, 'welcome'))
        );
      };
    },
  };

  // §11: resume this view's run, reshow or end the welcome, or start a run (R13, upgraders, Q8).
  const firstRun: DialogEntry = {
    id: 'firstRun',
    decide: async () => {
      const decision = await runAtOpen(
        surface,
        storedAtOpen,
        open.storedSessions,
        () => tourLockState(RUN_LOCK)
      );
      reportRunCheck(decision.check);
      // §12: another page of this view shows the run; setup and the guide come after it there.
      if (decision.check === 'elsewhere') return STAND_DOWN;
      return runOpener(decision, dispatch);
    },
  };

  // §3. For an open with no run and no setup pending; asks Chrome, so it is async.
  const pinGuide: DialogEntry = {
    id: 'pinGuide',
    decide: async () =>
      shouldShowPinGuide(
        open.getState().settingsDataState,
        await readToolbarPin()
      )
        ? () => dispatch(openPinGuide())
        : null,
  };

  // §3. For an open with no run: setup when pending; its close offers the pin guide.
  const setup: DialogEntry = {
    id: 'setup',
    decide: () =>
      shouldShowSetup(open.getState().settingsDataState)
        ? () => dispatch(openSetup())
        : null,
  };

  // KAN-149. A value moment, not the install age, opens it.
  const rate: DialogEntry = {
    id: 'rate',
    decide: () =>
      shouldAskForReview(storedAtOpen, Date.now())
        ? () =>
            void showWhenQuiet(
              () => dispatch(openRateAndReviewModal()),
              open.getState
            )
        : null,
  };

  // KAN-74. Every open that finds live groups and no grant.
  const tabGroups: DialogEntry = {
    id: 'tabGroups',
    decide: async () => {
      const count = await shouldOfferTabGroups();
      return count === null ? null : () => dispatch(openTabGroupsPrompt(count));
    },
  };

  // KAN-7 §6. Last, so it never shares an open with a dialog; sessions counted on disk.
  const fullViewCallout: DialogEntry = {
    id: 'fullViewCallout',
    decide: () =>
      shouldShowFullViewCallout(
        open.getState().settingsDataState,
        open.storedSessions
      )
        ? () =>
            void showWhenQuiet(
              () => dispatch(openFullViewCallout()),
              open.getState
            )
        : null,
  };

  const lists: Record<Surface, DialogEntry[]> = {
    popup: [cloudConsent, firstRun, rate, tabGroups, fullViewCallout],
    full: [cloudConsent, firstRun, setup, pinGuide, rate, tabGroups],
  };
  return lists[surface];
}
