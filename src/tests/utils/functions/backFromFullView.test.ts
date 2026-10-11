import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  chromeBackApi,
  isReturnFromFullViewRequest,
  planBack,
  RETURN_FROM_FULL_VIEW_MESSAGE,
  returnFromFullView,
  type BackApi,
  type BackFacts,
} from '../../../utils/functions/backFromFullView';
import { recordFullViewOrigins } from '../../../utils/functions/fullViewOrigin';
import { OPEN_IN_POPUP_MESSAGE } from '../../../utils/functions/openInPopup';
import {
  chromeTabApi,
  OPEN_IN_TAB_MESSAGE,
  openOrFocusTabView,
} from '../../../utils/functions/popOut';
import { recordRecentTabs } from '../../../utils/functions/recentTabs';
import { setupChromeFake } from '../../setup/chrome.fake';

// KAN-509. Under Default view Full the full view's Back goes to the tab KAN-507 would, with no popup.

afterEach(() => {
  vi.restoreAllMocks();
});

// The full view 7 in window 1 beside 6; window 2 holds 20.
const facts = (over: Partial<BackFacts> = {}): BackFacts => ({
  fullView: { tabId: 7, windowId: 1, pinned: false },
  origin: undefined,
  recent: [],
  windowTabIds: [6, 7],
  openTabIds: [6, 7, 20],
  ...over,
});

describe('planBack', () => {
  test('the recorded origin, wherever it is', () => {
    expect(planBack(facts({ origin: 20 }))).toEqual({
      kind: 'switch',
      tabId: 20,
    });
  });

  test('the origin closed: the newest open tab in the full view’s window record, never itself', () => {
    expect(planBack(facts({ origin: 99, recent: [7, 98, 6] }))).toEqual({
      kind: 'switch',
      tabId: 6,
    });
  });

  test('no record, unpinned beside other tabs: close it and let Chrome choose', () => {
    expect(planBack(facts())).toEqual({ kind: 'close' });
  });

  test('no record and pinned: nowhere to go', () => {
    expect(
      planBack(facts({ fullView: { tabId: 7, windowId: 1, pinned: true } }))
    ).toEqual({ kind: 'none' });
  });

  test('alone in its window with no record: nowhere to go, even with other windows open', () => {
    expect(planBack(facts({ windowTabIds: [7] }))).toEqual({ kind: 'none' });
  });
});

describe('isReturnFromFullViewRequest', () => {
  test('accepts its own message only', () => {
    expect(
      isReturnFromFullViewRequest({ type: RETURN_FROM_FULL_VIEW_MESSAGE })
    ).toBe(true);
    expect(isReturnFromFullViewRequest({ type: OPEN_IN_POPUP_MESSAGE })).toBe(
      false
    );
    expect(isReturnFromFullViewRequest(null)).toBe(false);
  });
});

type Entry =
  { call: 'activate'; tabId: number } | { call: 'removeTab'; tabId: number };

interface FakeTab {
  id: number;
  windowId: number;
  pinned?: boolean;
}

function makeApi(options: {
  tabs: FakeTab[];
  origin?: number;
  recent?: number[];
  refuseActivate?: boolean;
  refuseRecords?: boolean;
}): { api: BackApi; log: Entry[] } {
  const log: Entry[] = [];
  const tabs = options.tabs.map((t) => ({ ...t }));
  const api: BackApi = {
    getTab: async (tabId) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}.`);
      return { index: 0, pinned: tab.pinned ?? false, windowId: tab.windowId };
    },
    normalTabIds: async () => tabs.map((t) => t.id),
    tabIdsInWindow: async (windowId) =>
      tabs.filter((t) => t.windowId === windowId).map((t) => t.id),
    originOf: async () => {
      if (options.refuseRecords) throw new Error('storage refused');
      return options.origin;
    },
    recentTabsIn: async () => {
      if (options.refuseRecords) throw new Error('storage refused');
      return options.recent ?? [];
    },
    activate: async (tabId) => {
      log.push({ call: 'activate', tabId });
      if (options.refuseActivate) throw new Error('activate refused');
      return tabs.find((t) => t.id === tabId)?.windowId ?? -1;
    },
    removeTab: async (tabId) => {
      log.push({ call: 'removeTab', tabId });
    },
  };
  return { api, log };
}

const BESIDE: FakeTab[] = [
  { id: 6, windowId: 1 },
  { id: 7, windowId: 1 },
  { id: 20, windowId: 2 },
];

describe('returnFromFullView', () => {
  test('to the origin: that tab first, then the full view closes; no popup', async () => {
    const { api, log } = makeApi({ tabs: BESIDE, origin: 20 });

    await returnFromFullView(api, 7);

    expect(log).toEqual([
      { call: 'activate', tabId: 20 },
      { call: 'removeTab', tabId: 7 },
    ]);
  });

  test('pinned: back to the origin, the pinned full view stays', async () => {
    const { api, log } = makeApi({
      tabs: [{ id: 7, windowId: 1, pinned: true }, ...BESIDE.slice(2)],
      origin: 20,
    });

    await returnFromFullView(api, 7);

    expect(log).toEqual([{ call: 'activate', tabId: 20 }]);
  });

  test('no record beside other tabs: only the close', async () => {
    const { api, log } = makeApi({ tabs: BESIDE });

    await returnFromFullView(api, 7);

    expect(log).toEqual([{ call: 'removeTab', tabId: 7 }]);
  });

  test('nowhere to go: nothing happens', async () => {
    const { api, log } = makeApi({
      tabs: [{ id: 7, windowId: 1, pinned: true }],
    });

    await returnFromFullView(api, 7);

    expect(log).toEqual([]);
  });

  test('unpinned, alone in its window, nothing recorded: it does not close (that would close the window)', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 7, windowId: 1 },
        { id: 20, windowId: 2 },
      ],
    });

    await returnFromFullView(api, 7);

    expect(log).toEqual([]);
  });

  test('Chrome refuses the switch: the full view stays, and it warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: BESIDE,
      origin: 20,
      refuseActivate: true,
    });

    await returnFromFullView(api, 7);

    expect(log).toEqual([{ call: 'activate', tabId: 20 }]);
    expect(warn).toHaveBeenCalledWith(
      'Could not go back from the full view:',
      expect.any(Error)
    );
  });

  test('the records cannot be read: as with no record, and it warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: BESIDE, refuseRecords: true });

    await returnFromFullView(api, 7);

    expect(log).toEqual([{ call: 'removeTab', tabId: 7 }]);
    expect(warn).toHaveBeenCalledWith(
      'Could not read where to go back to:',
      expect.any(Error)
    );
  });

  test('not sent from a tab: nothing happens', async () => {
    const { api, log } = makeApi({ tabs: BESIDE, origin: 20 });

    await returnFromFullView(api, undefined);

    expect(log).toEqual([]);
  });
});

describe('KAN-509 against the chrome fake: toolbar, then Back', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });
  const FAKE_VIEW = 'chrome-extension://faketestid/index.html?view=tab';
  const activeIn = async (windowId: number) =>
    (await chrome.tabs.query({ active: true, windowId }))[0]?.id;

  test('lands back on the tab the toolbar was pressed on, closes the full view, opens no popup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handle = setupChromeFake({
      action: {},
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, url: 'https://a.test/' },
            { id: 12, url: 'https://b.test/', active: true },
            { id: 13, url: 'https://c.test/' },
          ],
        },
      ],
    });
    recordRecentTabs();
    recordFullViewOrigins();

    await openOrFocusTabView(chromeTabApi, {
      type: OPEN_IN_TAB_MESSAGE,
      windowId: 1,
    });
    const [fullView] = await chrome.tabs.query({ url: `${FAKE_VIEW}*` });
    if (fullView?.id === undefined) throw new Error('no full view');
    await returnFromFullView(chromeBackApi, fullView.id);

    expect(await activeIn(1)).toBe(12);
    expect(handle.removedTabIds).toEqual([fullView.id]);
    expect(handle.openPopupCalls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
