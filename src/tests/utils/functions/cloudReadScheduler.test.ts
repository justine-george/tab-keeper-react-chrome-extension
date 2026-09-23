import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  MIN_READ_GAP,
  TAB_READ_INTERVAL,
  startCloudReads,
  type VisibilitySource,
} from '../../../utils/functions/cloudReadScheduler';

// KAN-279 D11. A fake `document`: the scheduler only ever touches
// `visibilityState` and the visibilitychange listener, so this fake stands in
// for the real DOM Document without pulling jsdom into this (node) project.
// The test drives visibility by mutating `.visibilityState` directly and
// calling `fire()`, exactly as the real browser would call the registered
// listener.
function makeFakeDoc(initial: DocumentVisibilityState): {
  doc: VisibilitySource;
  setVisibility: (state: DocumentVisibilityState) => void;
  listenerCount: () => number;
} {
  let visibilityState = initial;
  const listeners = new Set<() => void>();
  const doc: VisibilitySource = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: (_t, l) => {
      listeners.add(l);
    },
    removeEventListener: (_t, l) => {
      listeners.delete(l);
    },
  };
  return {
    doc,
    setVisibility: (state) => {
      visibilityState = state;
      listeners.forEach((l) => l());
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startCloudReads', () => {
  test('visible at start: no read at 0, one at 10 min, one at 20 min', () => {
    const { doc } = makeFakeDoc('visible');
    const read = vi.fn();
    startCloudReads(doc, read, () => true);

    expect(read).not.toHaveBeenCalled();

    vi.advanceTimersByTime(TAB_READ_INTERVAL);
    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TAB_READ_INTERVAL);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('hidden at 5 min: no read at 10 min; visible again at 11 min reads at once (gap > 60s); the timer resumes ticking, not just the one catch-up read', () => {
    const { doc, setVisibility } = makeFakeDoc('visible');
    const read = vi.fn();
    startCloudReads(doc, read, () => true);

    vi.advanceTimersByTime(5 * 60_000);
    setVisibility('hidden');

    vi.advanceTimersByTime(5 * 60_000); // now at 10 min
    expect(read).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000); // now at 11 min
    setVisibility('visible');
    expect(read).toHaveBeenCalledTimes(1);

    // D11's core promise: a tab left and returned to keeps reading on its
    // timer, not just once on the way back in. Catches a regression that
    // does the catch-up read (tryRead()) but never restarts the interval
    // (startInterval()) -- every earlier assertion in this test still
    // passes against that broken code, because it never advances the clock
    // far enough to need a second tick.
    vi.advanceTimersByTime(TAB_READ_INTERVAL);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('hidden -> visible -> hidden -> visible within 30s of the last read: no extra read (the gap)', () => {
    const { doc, setVisibility } = makeFakeDoc('visible');
    const read = vi.fn();
    startCloudReads(doc, read, () => true);

    setVisibility('hidden');
    vi.advanceTimersByTime(10_000);
    setVisibility('visible'); // 10s since start (the startup read) -- within the 60s gap
    expect(read).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(10_000);
    setVisibility('visible'); // 30s since start -- still within the 60s gap
    expect(read).not.toHaveBeenCalled();
  });

  test('canRead false: no reads, and reads resume when it turns true at the next tick', () => {
    const { doc } = makeFakeDoc('visible');
    const read = vi.fn();
    let allowed = false;
    startCloudReads(doc, read, () => allowed);

    vi.advanceTimersByTime(TAB_READ_INTERVAL);
    expect(read).not.toHaveBeenCalled();

    allowed = true;
    vi.advanceTimersByTime(TAB_READ_INTERVAL);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('the returned stop function clears the timer and the listener', () => {
    const { doc, listenerCount } = makeFakeDoc('visible');
    const read = vi.fn();
    const stop = startCloudReads(doc, read, () => true);

    expect(listenerCount()).toBe(1);
    stop();
    expect(listenerCount()).toBe(0);

    vi.advanceTimersByTime(TAB_READ_INTERVAL * 3);
    expect(read).not.toHaveBeenCalled();
  });

  // Off the happy path.

  test('hidden AT START (a tab created in the background): no timer runs, and becoming visible after more than 60s reads at once', () => {
    const { doc, setVisibility } = makeFakeDoc('hidden');
    const read = vi.fn();
    startCloudReads(doc, read, () => true);

    // No interval should be ticking while hidden.
    vi.advanceTimersByTime(TAB_READ_INTERVAL * 2);
    expect(read).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MIN_READ_GAP + 1_000);
    setVisibility('visible');
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('read throwing does not kill the scheduler: the next tick still runs', () => {
    const { doc } = makeFakeDoc('visible');
    const read = vi.fn(() => {
      throw new Error('sync failed');
    });
    startCloudReads(doc, read, () => true);

    expect(() => vi.advanceTimersByTime(TAB_READ_INTERVAL)).not.toThrow();
    expect(read).toHaveBeenCalledTimes(1);

    expect(() => vi.advanceTimersByTime(TAB_READ_INTERVAL)).not.toThrow();
    expect(read).toHaveBeenCalledTimes(2);
  });

  // A tick where canRead() refuses must leave
  // `lastRead` untouched -- not stamp it as if a read had happened. Proof: a
  // refused tick at 10 min, canRead turning true right after, then a
  // hide/show only 1s later (still nowhere near a fresh 60s gap from THAT
  // tick) still reads, because the gap is correctly measured from the
  // session's real start (t=0, > 60s ago) rather than from the refused
  // attempt. A scheduler that wrongly stamped `lastRead` on the refused tick
  // would measure only 1s since that stamp and refuse.
  test('canRead refusing a tick does not bump lastRead: a hide/show shortly after still reads once canRead turns true', () => {
    const { doc, setVisibility } = makeFakeDoc('visible');
    const read = vi.fn();
    let allowed = false;
    startCloudReads(doc, read, () => allowed);

    vi.advanceTimersByTime(TAB_READ_INTERVAL); // t = 10 min; tick refused by canRead()
    expect(read).not.toHaveBeenCalled();

    allowed = true;
    vi.advanceTimersByTime(1_000); // t = 10 min + 1s -- shortly after the refused tick
    setVisibility('hidden');
    setVisibility('visible');

    expect(read).toHaveBeenCalledTimes(1);
  });
});

// Dropping the defensive `stopInterval()` at the top
// of `startInterval` was left untested on purpose. `startInterval` is only
// ever called from two places -- once at construction (only if already
// visible) and once from `onVisibilityChange`'s 'visible' branch -- and the
// DOM only fires `visibilitychange` on an ACTUAL state transition, so a real
// browser can never deliver two 'visible' calls back to back without a
// 'hidden' in between (which already calls `stopInterval()` on its own
// branch). No sequence this module can be driven through -- by a real
// browser, or by this fake doc, which mirrors the same one-listener,
// caller-fires-on-change contract -- reaches `startInterval` with an
// interval already running. A test asserting no leaked interval in that case
// would have to call the internal function directly or fire 'visible' twice
// from a fake doc that violates the real contract, which would test the fake
// rather than the scheduler. Left undone; said here instead of covered by a
// vacuous test.
