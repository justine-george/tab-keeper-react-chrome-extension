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

  // KAN-259. Asked once, before the others. An existing user (an install date
  // from an earlier open, or sessions on disk) who already turned Auto Sync
  // off is recorded as declined without asking: they answered, in the only
  // way there used to be.
  const cloudConsent: DialogEntry = {
    id: 'cloudConsent',
    decide: () => {
      if (
        storedAtOpen.cloudConsent === 'granted' ||
        storedAtOpen.cloudConsent === 'declined'
      ) {
        return null;
      }
      const isExisting =
        isValidDate(storedAtOpen.extensionInstalledTime ?? '') ||
        open.storedSessions > 0;
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

  // KAN-7 §4. Asks Chrome, so it is the one async entry before the rate prompt.
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

  // KAN-7 §5. Reached here when the guide does not apply; else the guide's close opens it.
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
        ? () => dispatch(openRateAndReviewModal())
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
        ? () => dispatch(openFullViewCallout())
        : null,
  };

  const lists: Record<Surface, DialogEntry[]> = {
    popup: [cloudConsent, fullViewOffer, rate, tabGroups, fullViewCallout],
    full: [cloudConsent, pinGuide, setup, rate, tabGroups],
  };
  return lists[surface];
}
