import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  QUIET_BREAKERS,
  waitForQuiet,
  type QuietOutcome,
} from '../../../utils/functions/quietWait';

// Quiet means no keydown, pointerdown, wheel or drag start for the whole delay.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function watched(delayMs: number) {
  let outcome: QuietOutcome | null = null;
  void waitForQuiet(delayMs).then((o) => {
    outcome = o;
  });
  return () => outcome;
}

describe('waitForQuiet', () => {
  test('quiet after the delay, and not a millisecond before', async () => {
    const outcome = watched(1500);
    await vi.advanceTimersByTimeAsync(1499);
    expect(outcome()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome()).toBe('quiet');
  });

  test.each(QUIET_BREAKERS)(
    'a %s first interrupts it at once',
    async (type) => {
      const outcome = watched(1500);
      document.dispatchEvent(new Event(type, { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome()).toBe('interrupted');
    }
  );

  test('an Esc during the wait is left unprevented, so Chrome closes the popup as usual', async () => {
    const outcome = watched(1500);
    const esc = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(esc);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome()).toBe('interrupted');
    expect(esc.defaultPrevented).toBe(false);
  });
});
