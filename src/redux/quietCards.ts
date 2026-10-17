import type { RootState } from './store';
import { CARD_DELAY_MS } from '../utils/constants/cardDelay';
import { waitForQuiet } from '../utils/functions/quietWait';

export type CardState = 'waiting' | 'shown' | 'skipped';

// KAN-653. The quiet card still waiting to show, so the review card can wait
// for it rather than take the page first and then share it.
let waiting: Promise<CardState> | null = null;

export const whenQuietCardSettles = (): Promise<unknown> | null => waiting;

// Opens the card after a quiet wait; <html data-first-open-card> is the e2e barrier.
export function showWhenQuiet(
  open: () => void,
  getState: () => RootState
): Promise<CardState> {
  const shown = decideQuietCard(open, getState);
  waiting = shown;
  void shown.finally(() => {
    if (waiting === shown) waiting = null;
  });
  return shown;
}

async function decideQuietCard(
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
