import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  holdTourLock,
  RUN_LOCK,
  tourLockState,
} from '../../../utils/functions/tourLock';
import { installFakeLocks, type FakeLocks } from '../../setup/fakeLocks';

// jsdom project only: Node 26 has navigator.locks, so "without Web Locks" would not run under node.

let locks: FakeLocks | null = null;
afterEach(() => {
  locks?.uninstall();
  locks = null;
  vi.restoreAllMocks();
});

describe('with Web Locks', () => {
  test('a held lock reads as held, under its own name only', async () => {
    locks = installFakeLocks();
    await holdTourLock(RUN_LOCK);
    expect(locks.held).toEqual(new Set([RUN_LOCK]));
    expect(await tourLockState(RUN_LOCK)).toBe('held');
    expect(await tourLockState('another')).toBe('free');
  });

  test('letting go frees it, and is no loss', async () => {
    locks = installFakeLocks();
    const onLost = vi.fn();
    const release = await holdTourLock(RUN_LOCK, onLost);
    release();
    await vi.waitFor(async () =>
      expect(await tourLockState(RUN_LOCK)).toBe('free')
    );
    expect(onLost).not.toHaveBeenCalled();
  });

  test('a second page takes it, and the first hears it lost it', async () => {
    locks = installFakeLocks();
    const firstLost = vi.fn();
    const secondLost = vi.fn();
    await holdTourLock(RUN_LOCK, firstLost);
    await holdTourLock(RUN_LOCK, secondLost);
    await vi.waitFor(() => expect(firstLost).toHaveBeenCalledTimes(1));
    expect(secondLost).not.toHaveBeenCalled();
    expect(await tourLockState(RUN_LOCK)).toBe('held');
  });

  test('a page that went away holds nothing', async () => {
    locks = installFakeLocks();
    await holdTourLock(RUN_LOCK);
    locks.dropAll();
    expect(await tourLockState(RUN_LOCK)).toBe('free');
  });

  test('a refused request still lets the run show, holding nothing', async () => {
    locks = installFakeLocks({ requestRejects: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onLost = vi.fn();
    const release = await holdTourLock(RUN_LOCK, onLost);
    release();
    expect(await tourLockState(RUN_LOCK)).toBe('free');
    expect(onLost).not.toHaveBeenCalled();
  });

  test('a query that fails reads as unknown', async () => {
    locks = installFakeLocks({ queryRejects: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await tourLockState(RUN_LOCK)).toBe('unknown');
  });
});

describe('without Web Locks', () => {
  test('holding is a no-op and the state is unknown', async () => {
    const release = await holdTourLock(RUN_LOCK);
    release();
    expect('locks' in navigator).toBe(false);
    expect(await tourLockState(RUN_LOCK)).toBe('unknown');
  });
});
