import type { RootState } from './store';
import { CARD_DELAY_MS } from '../utils/constants/cardDelay';
import { waitForQuiet } from '../utils/functions/quietWait';

export type CardState = 'waiting' | 'shown' | 'skipped';

// Opens the card after a quiet wait; <html data-first-open-card> is the e2e barrier.
export async function showWhenQuiet(
  open: () => void,
  getState: () => RootState
): Promise<CardState> {
  const root = document.documentElement;
  root.dataset.firstOpenCard = 'waiting';
  const outcome = await waitForQuiet(CARD_DELAY_MS);
  // A dialog or the run can arrive with no gesture here: a Help request from the popup.
  const isClear =
    outcome === 'quiet' &&
    document.querySelector('dialog:modal') === null &&
    !getState().globalState.hasRunShownHere;
  if (isClear) open();
  const state: CardState = isClear ? 'shown' : 'skipped';
  root.dataset.firstOpenCard = state;
  return state;
}
