import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';

import type { DialogEntry } from '../utils/functions/dialogQueue';
import {
  openCloudConsentModal,
  openRateAndReviewModal,
  openTabGroupsPrompt,
} from './slices/globalStateSlice';
import {
  declineCloudConsent,
  type SettingsData,
} from './slices/settingsDataStateSlice';
import { isValidDate } from '../utils/functions/local';
import { shouldAskForReview } from '../utils/functions/reviewAsk';
import { shouldOfferTabGroups } from '../utils/functions/tabGroupsOffer';

export type Surface = 'popup' | 'full';

export interface FirstOpen {
  dispatch: Dispatch<UnknownAction>;
  // settingsData as stored before this open wrote anything.
  storedAtOpen: Partial<SettingsData>;
  // Saved sessions on disk at this open; the store has not loaded them yet.
  storedSessions: number;
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
      const variant = isExisting ? 'existing' : 'welcome';
      return () => dispatch(openCloudConsentModal({ variant }));
    },
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

  const lists: Record<Surface, DialogEntry[]> = {
    popup: [cloudConsent, rate, tabGroups],
    full: [cloudConsent, rate, tabGroups],
  };
  return lists[surface];
}
