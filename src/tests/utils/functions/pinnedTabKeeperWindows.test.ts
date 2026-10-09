import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  PINNED_TAB_KEEPER_WINDOWS_KEY,
  keepPinnedTabKeeperWindows,
} from '../../../utils/functions/pinnedTabKeeperWindows';
import { setupChromeFake } from '../../setup/chrome.fake';
import { buildChromeTab } from '../../fixtures/chromeTab';

// KAN-470 A. An update closes every Tab Keeper tab; the worker remembers the windows that pinned one and puts a stub back.

const STUB = 'chrome-extension://faketestid/pinned.html';
const FULL = 'chrome-extension://faketestid/index.html?view=tab';
const NEW_TAB = 'chrome://newtab/';
const WEB = 'https://a.test/';

let handle: ReturnType<typeof setupChromeFake> | undefined;
let nextTabId = 100;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const tab = (url: string, pinned = false, windowId = 1) =>
  buildChromeTab({ id: nextTabId++, url, pinned, windowId });

const recorded = () => handle?.localArea()[PINNED_TAB_KEEPER_WINDOWS_KEY];

const tabsOf = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map((t) => `${t.pinned ? '📌' : ''}${t.url}`);

describe('the record', () => {
  test('holds each window with a pinned Tab Keeper tab, stub or full view', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [tab(STUB, true), tab(WEB)] },
        { id: 2, tabs: [tab(FULL, true, 2), tab(WEB, false, 2)] },
        { id: 3, tabs: [tab(FULL, false, 3), tab(WEB, false, 3)] },
        { id: 4, tabs: [tab(WEB, true, 4), tab(WEB, false, 4)] },
      ],
    });
    keepPinnedTabKeeperWindows();
    handle.fireStartup();

    await vi.waitFor(() => expect(recorded()).toEqual([1, 2]));
  });

  test('follows a pin, an unpin and a close', async () => {
    handle = setupChromeFake({ windows: [{ id: 1, tabs: [tab(WEB)] }] });
    keepPinnedTabKeeperWindows();

    const stub = await chrome.tabs.create({
      windowId: 1,
      url: STUB,
      index: 0,
      pinned: true,
    });
    await vi.waitFor(() => expect(recorded()).toEqual([1]));

    await chrome.tabs.update(stub.id ?? -1, { pinned: false });
    await vi.waitFor(() => expect(recorded()).toEqual([]));

    await chrome.tabs.update(stub.id ?? -1, { pinned: true });
    await vi.waitFor(() => expect(recorded()).toEqual([1]));
    await chrome.tabs.remove(stub.id ?? -1);
    await vi.waitFor(() => expect(recorded()).toEqual([]));
  });

  // The worker starting for an update must not overwrite the record before the restore reads it.
  test('is not rewritten when the worker loads', async () => {
    handle = setupChromeFake({ windows: [{ id: 1, tabs: [tab(WEB)] }] });
    await chrome.storage.local.set({ [PINNED_TAB_KEEPER_WINDOWS_KEY]: [1] });

    keepPinnedTabKeeperWindows();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recorded()).toEqual([1]);
  });
});

describe('after an update', () => {
  const update = () =>
    handle?.fireInstalled({ reason: 'update', previousVersion: '1.9.0' });

  test('a pinned stub goes first in every recorded window still open, and in no other', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [tab(WEB)] },
        { id: 2, tabs: [tab(WEB, true, 2), tab(WEB, false, 2)] },
        { id: 3, tabs: [tab(WEB, false, 3)] },
      ],
    });
    await chrome.storage.local.set({
      [PINNED_TAB_KEEPER_WINDOWS_KEY]: [1, 2, 9],
    });
    keepPinnedTabKeeperWindows();
    update();

    await vi.waitFor(() => expect(recorded()).toEqual([1, 2]));
    expect(await tabsOf(1)).toEqual([`📌${STUB}`, WEB]);
    expect(await tabsOf(2)).toEqual([`📌${STUB}`, `📌${WEB}`, WEB]);
    expect(await tabsOf(3)).toEqual([WEB]);
  });

  test('Chrome’s pinned New Tab, left where Tab Keeper’s tab was the only one, is closed', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1, tabs: [tab(NEW_TAB, true)] }],
    });
    await chrome.storage.local.set({ [PINNED_TAB_KEEPER_WINDOWS_KEY]: [1] });
    keepPinnedTabKeeperWindows();
    update();

    await vi.waitFor(async () =>
      expect(await tabsOf(1)).toEqual([`📌${STUB}`])
    );
  });

  test('CONTROL: a window that still has its pinned Tab Keeper tab gets no second, and keeps its pinned New Tab', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [tab(FULL, true), tab(NEW_TAB, true)] },
        { id: 2, tabs: [tab(WEB, false, 2)] },
      ],
    });
    await chrome.storage.local.set({
      [PINNED_TAB_KEEPER_WINDOWS_KEY]: [1, 2],
    });
    keepPinnedTabKeeperWindows();
    update();

    // Windows go in order: once window 2 has its stub, window 1 is settled.
    await vi.waitFor(async () =>
      expect(await tabsOf(2)).toEqual([`📌${STUB}`, WEB])
    );
    expect(await tabsOf(1)).toEqual([`📌${FULL}`, `📌${NEW_TAB}`]);
  });

  test('an install restores nothing, and records what is there', async () => {
    handle = setupChromeFake({ windows: [{ id: 1, tabs: [tab(WEB)] }] });
    await chrome.storage.local.set({ [PINNED_TAB_KEEPER_WINDOWS_KEY]: [1] });
    keepPinnedTabKeeperWindows();
    handle.fireInstalled({ reason: 'install' });

    await vi.waitFor(() => expect(recorded()).toEqual([]));
    expect(await tabsOf(1)).toEqual([WEB]);
  });
});
