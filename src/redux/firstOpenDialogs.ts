import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';

import type { DialogEntry } from '../utils/functions/dialogQueue';
import type { RootState } from './store';
import {
  openCloudConsentModal,
  openFullViewCallout,
  openFullViewOffer,
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
  shouldOfferFullView,
  shouldShowFullViewCallout,
  shouldShowPinGuide,
  shouldShowSetup,
} from '../utils/functions/onboarding';
import { showWhenQuiet } from './quietCards';
import { shouldAskForReview } from '../utils/functions/reviewAsk';
import { readToolbarPin } from '../utils/functions/toolbarPin';
import { shouldOfferTabGroups } from '../utils/functions/tabGroupsOffer';

export type Surface = 'popup' | 'full';

export interface FirstOpen {
  dispatch: Dispatch<UnknownAction>;
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
      // KAN-410. Recorded as it opens: a popup closed unanswered stays local-only and mid-onboarding.
      return () => {
        dispatch(declineCloudConsent());
        dispatch(beginSetup());
        dispatch(openCloudConsentModal({ variant: 'welcome' }));
      };
    },
  };

  // KAN-7 §3. A popup closed before the answer asks again on the next open.
  const fullViewOffer: DialogEntry = {
    id: 'fullViewOffer',
    decide: () =>
      shouldOfferFullView(open.getState().settingsDataState)
        ? () => dispatch(openFullViewOffer())
        : null,
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
    popup: [cloudConsent, fullViewOffer, rate, tabGroups, fullViewCallout],
    full: [cloudConsent, setup, pinGuide, rate, tabGroups],
  };
  return lists[surface];
}
