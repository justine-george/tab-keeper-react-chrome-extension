import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { showWhenQuiet } from '../../redux/quietCards';
import { CARD_DELAY_MS } from '../../utils/constants/cardDelay';
import {
  openFullViewCallout,
  runShownHere,
} from '../../redux/slices/globalStateSlice';

// The card's open waits for quiet; html[data-first-open-card] reports each stage.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.firstOpenCard;
  vi.restoreAllMocks();
});

describe('showWhenQuiet', () => {
  test('a modal dialog that opened during the wait skips it', async () => {
    const { store } = makeTestStore();
    const modal = document.createElement('dialog');
    vi.spyOn(document, 'querySelector').mockImplementation(
      (selector: string) => (selector === 'dialog:modal' ? modal : null)
    );
    const shown = showWhenQuiet(
      () => store.dispatch(openFullViewCallout()),
      store.getState
    );
    await vi.advanceTimersByTimeAsync(CARD_DELAY_MS);
    expect(await shown).toBe('skipped');
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
  });

  test('a run that showed during the wait skips it', async () => {
    const { store } = makeTestStore();
    const shown = showWhenQuiet(
      () => store.dispatch(openFullViewCallout()),
      store.getState
    );
    store.dispatch(runShownHere());
    await vi.advanceTimersByTimeAsync(CARD_DELAY_MS);
    expect(await shown).toBe('skipped');
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
  });
});
