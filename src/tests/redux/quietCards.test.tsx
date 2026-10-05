import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { showWhenQuiet } from '../../redux/quietCards';
import { CARD_DELAY_MS } from '../../utils/constants/cardDelay';
import {
  openFullViewCallout,
  tourStartedHere,
} from '../../redux/slices/globalStateSlice';

// The card's open waits for quiet; html[data-first-open-card] reports each stage.

const card = () => document.documentElement.dataset.firstOpenCard;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.firstOpenCard;
  vi.restoreAllMocks();
});

describe('showWhenQuiet', () => {
  test('waiting, then shown after CARD_DELAY_MS of quiet', async () => {
    const { store } = makeTestStore();
    const shown = showWhenQuiet(
      () => store.dispatch(openFullViewCallout()),
      store.getState
    );
    expect(card()).toBe('waiting');
    await vi.advanceTimersByTimeAsync(CARD_DELAY_MS - 1);
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await shown).toBe('shown');
    expect(card()).toBe('shown');
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(true);
  });

  test('an interaction first: skipped, never opened', async () => {
    const { store } = makeTestStore();
    const shown = showWhenQuiet(
      () => store.dispatch(openFullViewCallout()),
      store.getState
    );
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(CARD_DELAY_MS);
    expect(await shown).toBe('skipped');
    expect(card()).toBe('skipped');
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
  });

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

  test('a tour that started during the wait skips it', async () => {
    const { store } = makeTestStore();
    const shown = showWhenQuiet(
      () => store.dispatch(openFullViewCallout()),
      store.getState
    );
    store.dispatch(tourStartedHere('sample:x'));
    await vi.advanceTimersByTimeAsync(CARD_DELAY_MS);
    expect(await shown).toBe('skipped');
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
  });
});
