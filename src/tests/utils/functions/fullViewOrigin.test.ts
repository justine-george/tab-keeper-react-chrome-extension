import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  fullViewOriginKey,
  fullViewOrigins,
} from '../../../utils/functions/fullViewOrigin';
import type { SessionArea } from '../../../utils/functions/recentTabs';
import { setupChromeFake } from '../../setup/chrome.fake';

// KAN-507. The tab ⤢ was pressed on, kept for one visit to the full view it opened.

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const area = (): SessionArea => ({
  get: (keys) => chrome.storage.session.get(keys),
  set: (items) => chrome.storage.session.set(items),
  remove: (keys) => chrome.storage.session.remove(keys),
});

// The full view is tab 7 in window 1; ⤢ was pressed on tab 20.
const FULL_VIEW = { tabId: 7, windowId: 1 };

describe('fullViewOrigins', () => {
  test('remembers the origin of a full view, read back by that full view', async () => {
    handle = setupChromeFake();
    const origins = fullViewOrigins(area());

    await origins.remember(FULL_VIEW, 20);

    expect(await origins.originOf(FULL_VIEW)).toBe(20);
    expect(handle.sessionArea()).toEqual({
      [fullViewOriginKey(1)]: { fullViewTabId: 7, originTabId: 20 },
    });
  });

  test('another tab in the same window reads no origin', async () => {
    handle = setupChromeFake();
    const origins = fullViewOrigins(area());

    await origins.remember(FULL_VIEW, 20);

    expect(await origins.originOf({ tabId: 8, windowId: 1 })).toBeUndefined();
  });

  test('another tab becoming active in the full view’s window drops the record', async () => {
    handle = setupChromeFake();
    const origins = fullViewOrigins(area());
    await origins.remember(FULL_VIEW, 20);

    await origins.activated({ tabId: 6, windowId: 1 });

    expect(await origins.originOf(FULL_VIEW)).toBeUndefined();
    expect(handle.sessionArea()).toEqual({});
  });

  test('the full view itself becoming active, or a tab in another window, keeps it', async () => {
    handle = setupChromeFake();
    const origins = fullViewOrigins(area());
    await origins.remember(FULL_VIEW, 20);

    await origins.activated({ tabId: 7, windowId: 1 });
    await origins.activated({ tabId: 21, windowId: 2 });

    expect(await origins.originOf(FULL_VIEW)).toBe(20);
  });

  test('the full view’s window closing drops the record', async () => {
    handle = setupChromeFake();
    const origins = fullViewOrigins(area());
    await origins.remember(FULL_VIEW, 20);

    await origins.windowRemoved(1);

    expect(handle.sessionArea()).toEqual({});
  });

  test('writes run in the order they were asked: a remember after an activation survives it', async () => {
    handle = setupChromeFake();
    const origins = fullViewOrigins(area());
    await origins.remember(FULL_VIEW, 20);

    void origins.activated({ tabId: 6, windowId: 1 });
    await origins.remember(FULL_VIEW, 21);

    expect(await origins.originOf(FULL_VIEW)).toBe(21);
  });

  test('a stored value that is not a record reads as none', async () => {
    handle = setupChromeFake();
    await chrome.storage.session.set({ [fullViewOriginKey(1)]: 'junk' });

    expect(await fullViewOrigins(area()).originOf(FULL_VIEW)).toBeUndefined();
  });
});
