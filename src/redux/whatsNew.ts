import type { AppDispatch } from './store';
import {
  closeWhatsNew,
  openSettingsPage,
  openWhatsNew,
} from './slices/globalStateSlice';
import { clearPendingAsk, noteReviewMoment } from './reviewAsk';
import {
  releasesToShow,
  settingsPageOf,
  showsDefaultChange,
  type ShownRelease,
} from '../utils/functions/whatsNew';
import { WHATS_NEW_SINCE_KEY } from '../utils/functions/whatsNewSince';

// KAN-861. What's new after an update: the first-open entry and its answers.

const removeSince = (): void => {
  chrome.storage.local.remove(WHATS_NEW_SINCE_KEY).catch((error) => {
    console.warn("Could not clear What's new:", error);
  });
};

// The opener when an update left releases to show. Anything else clears a stored key; showing never does.
export async function decideWhatsNew(
  dispatch: AppDispatch
): Promise<(() => void) | null> {
  const items = await chrome.storage.local.get(WHATS_NEW_SINCE_KEY);
  if (!(WHATS_NEW_SINCE_KEY in items)) return null;
  const shown = releasesToShow(
    items[WHATS_NEW_SINCE_KEY],
    chrome.runtime.getManifest().version
  );
  if (shown.length === 0) {
    removeSince();
    return null;
  }
  return () => dispatch(openWhatsNew(shown));
}

export type WhatsNewAnswer = 'gotIt' | 'openSettings' | 'dismissed';

// Every answer clears the key, which closes it on any other page showing it.
export const answerWhatsNew =
  (answer: WhatsNewAnswer, shown: readonly ShownRelease[]) =>
  (dispatch: AppDispatch): void => {
    removeSince();
    dispatch(closeWhatsNew());
    // No ask straight after telling people a default changed, not even one another page noted.
    if (showsDefaultChange(shown)) dispatch(clearPendingAsk());
    else if (answer === 'gotIt')
      dispatch(noteReviewMoment({ kind: 'updated' }));
    if (answer === 'openSettings') {
      const page = settingsPageOf(shown);
      if (page !== null) void dispatch(openSettingsPage(page));
    }
  };
