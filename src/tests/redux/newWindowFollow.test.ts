import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  NEW_WINDOW_FOLLOW_MS,
  clearNewWindowFollow,
  expectNewWindow,
  pendingNewWindow,
  subscribeNewWindowFollow,
} from '../../redux/newWindowFollow';

afterEach(() => {
  clearNewWindowFollow();
  vi.useRealTimers();
});

// KAN-852. A copy's new window, waited for until Open now lists it.
describe('newWindowFollow', () => {
  test('each ask is a new wait, and tells its listeners', () => {
    const told = vi.fn();
    const stop = subscribeNewWindowFollow(told);

    expectNewWindow();
    const first = pendingNewWindow();
    expectNewWindow();

    expect(first).not.toBeNull();
    expect(pendingNewWindow()).not.toBe(first);
    expect(told).toHaveBeenCalledTimes(2);
    stop();
  });

  test(`forgotten after ${NEW_WINDOW_FOLLOW_MS}ms`, () => {
    vi.useFakeTimers();
    expectNewWindow();

    vi.advanceTimersByTime(NEW_WINDOW_FOLLOW_MS - 1);
    expect(pendingNewWindow()).not.toBeNull();
    vi.advanceTimersByTime(1);

    expect(pendingNewWindow()).toBeNull();
  });
});
