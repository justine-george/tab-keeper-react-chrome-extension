import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  holdTourLock,
  tourLockName,
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
    await holdTourLock('sample:a');
    expect(locks.held).toEqual(new Set([tourLockName('sample:a')]));
    expect(await tourLockState('sample:a')).toBe('held');
    expect(await tourLockState('sample:b')).toBe('free');
  });

  test('letting go frees it', async () => {
    locks = installFakeLocks();
    const release = await holdTourLock('sample:a');
    release();
    await vi.waitFor(async () =>
      expect(await tourLockState('sample:a')).toBe('free')
    );
  });

  test('a page that went away holds nothing', async () => {
    locks = installFakeLocks();
    await holdTourLock('sample:a');
    locks.dropAll();
    expect(await tourLockState('sample:a')).toBe('free');
  });

  test('a refused request still lets the tour start, holding nothing', async () => {
    locks = installFakeLocks({ requestRejects: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const release = await holdTourLock('sample:a');
    release();
    expect(await tourLockState('sample:a')).toBe('free');
  });

  test('a query that fails reads as unknown', async () => {
    locks = installFakeLocks({ queryRejects: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await tourLockState('sample:a')).toBe('unknown');
  });
});

describe('without Web Locks', () => {
  test('CONTROL: this jsdom has none', () => {
    expect('locks' in navigator).toBe(false);
  });

  test('the start goes on, and no page can be asked about', async () => {
    const release = await holdTourLock('sample:a');
    release();
    expect(await tourLockState('sample:a')).toBe('unknown');
  });
});
