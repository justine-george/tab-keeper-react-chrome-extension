import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  isOpenInTabRequest,
  isShowInFullViewMessage,
  OPEN_IN_TAB_MESSAGE,
  openOrFocusTabView,
  OpenInTabRequest,
  SHOW_IN_FULL_VIEW_MESSAGE,
  type ShowInFullViewMessage,
  TabApi,
} from '../../../utils/functions/popOut';

// A tab that satisfies chrome.tabs.Tab's required fields without a cast.
// Only id, windowId and url ever vary across these tests.
function fakeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    frozen: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    lastAccessed: 0,
    ...overrides,
  };
}

type Calls = {
  queries: { url: string }[];
  updates: { tabId: number; props: { active: boolean; url?: string } }[];
  focusWindows: number[];
  creates: {
    url: string;
    index: number;
    windowId?: number;
    active: boolean;
  }[];
  announces: ShowInFullViewMessage[];
};

// Hand-made TabApi fake: records every call it receives rather than
// asserting a mock was invoked, so the tests below read the actual
// arguments the implementation chose to pass.
function makeTabApi(
  options: {
    matches?: chrome.tabs.Tab[];
    stubMatches?: chrome.tabs.Tab[];
    rejectQuery?: boolean;
    rejectAnnounce?: boolean;
  } = {}
): { api: TabApi; calls: Calls } {
  const calls: Calls = {
    queries: [],
    updates: [],
    focusWindows: [],
    creates: [],
    announces: [],
  };

  const api: TabApi = {
    getURL: (path) => `chrome-extension://x/${path}`,
    query: async (q) => {
      calls.queries.push(q);
      if (options.rejectQuery) throw new Error('query failed');
      return q.url.includes('pinned.html')
        ? (options.stubMatches ?? [])
        : (options.matches ?? []);
    },
    update: async (tabId, props) => {
      calls.updates.push({ tabId, props });
      return undefined;
    },
    focusWindow: async (windowId) => {
      calls.focusWindows.push(windowId);
      return undefined;
    },
    create: async (props) => {
      calls.creates.push(props);
      return undefined;
    },
    announce: async (message) => {
      calls.announces.push(message);
      if (options.rejectAnnounce) throw new Error('no page listening');
      return undefined;
    },
  };

  return { api, calls };
}

function request(windowId: number | undefined): OpenInTabRequest {
  return { type: OPEN_IN_TAB_MESSAGE, windowId };
}

describe('isOpenInTabRequest', () => {
  test('accepts the open-in-tab request, windowId included', () => {
    expect(isOpenInTabRequest({ type: OPEN_IN_TAB_MESSAGE, windowId: 5 })).toBe(
      true
    );
  });

  test('accepts the open-in-tab request with windowId undefined', () => {
    expect(
      isOpenInTabRequest({ type: OPEN_IN_TAB_MESSAGE, windowId: undefined })
    ).toBe(true);
  });

  // The `windowId` key can be absent entirely, not just present with value
  // `undefined` -- OpenInTabRequest is a required field at the TYPE level,
  // but nothing stops a caller (or a hand-built test message) from omitting
  // the key at runtime, and popOut.ts's `if (!('windowId' in message))
  // return true;` is what accepts that.
  test('accepts the open-in-tab request with the windowId key absent entirely', () => {
    expect(isOpenInTabRequest({ type: OPEN_IN_TAB_MESSAGE })).toBe(true);
  });

  test('rejects a restore-session request', () => {
    expect(isOpenInTabRequest({ type: 'restoreSession' })).toBe(false);
  });

  test('rejects non-objects and null', () => {
    expect(isOpenInTabRequest(null)).toBe(false);
    expect(isOpenInTabRequest('openInTab')).toBe(false);
    expect(isOpenInTabRequest(undefined)).toBe(false);
  });

  test('rejects a windowId of the wrong type', () => {
    expect(
      isOpenInTabRequest({ type: OPEN_IN_TAB_MESSAGE, windowId: '5' })
    ).toBe(false);
  });
});

describe('openOrFocusTabView', () => {
  test('an existing tab view is activated and its window focused, nothing created', async () => {
    const { api, calls } = makeTabApi({
      matches: [fakeTab({ id: 7, windowId: 3 })],
    });

    await openOrFocusTabView(api, request(5));

    expect(calls.updates).toEqual([{ tabId: 7, props: { active: true } }]);
    expect(calls.focusWindows).toEqual([3]);
    expect(calls.creates).toEqual([]);
  });

  test('queries for the tab view URL with a trailing wildcard', async () => {
    const { api, calls } = makeTabApi({ matches: [] });

    await openOrFocusTabView(api, request(5));

    expect(calls.queries).toEqual([
      { url: 'chrome-extension://x/index.html?view=tab*' },
      { url: 'chrome-extension://x/pinned.html*' },
    ]);
  });

  test('no existing tab view creates one in the given window, at index 0', async () => {
    const { api, calls } = makeTabApi({ matches: [] });

    await openOrFocusTabView(api, request(5));

    expect(calls.creates).toEqual([
      {
        url: 'chrome-extension://x/index.html?view=tab',
        index: 0,
        windowId: 5,
        active: true,
      },
    ]);
    expect(calls.updates).toEqual([]);
    expect(calls.focusWindows).toEqual([]);
  });

  test('an undefined request windowId creates without a windowId key, not windowId: undefined', async () => {
    const { api, calls } = makeTabApi({ matches: [] });

    await openOrFocusTabView(api, request(undefined));

    expect(calls.creates).toHaveLength(1);
    expect('windowId' in calls.creates[0]).toBe(false);
    expect(calls.creates[0]).toEqual({
      url: 'chrome-extension://x/index.html?view=tab',
      index: 0,
      active: true,
    });
  });

  // chrome.tabs.Tab's `id` is optional in @types/chrome (unlike `windowId`,
  // which is required) -- Chrome can hand back a match it will not give an id
  // for. There is nothing to call update()/focusWindow() with in that case,
  // so it is treated the same as no match: fall through to create.
  test('a matched tab with no id is treated as no match, and a new tab is created', async () => {
    const { api, calls } = makeTabApi({ matches: [fakeTab({ windowId: 3 })] });

    await openOrFocusTabView(api, request(5));

    expect(calls.updates).toEqual([]);
    expect(calls.focusWindows).toEqual([]);
    expect(calls.creates).toEqual([
      {
        url: 'chrome-extension://x/index.html?view=tab',
        index: 0,
        windowId: 5,
        active: true,
      },
    ]);
  });

  test('KAN-459: a Tab Keeper tab in the asking window wins over one elsewhere', async () => {
    const { api, calls } = makeTabApi({
      matches: [
        fakeTab({
          id: 7,
          windowId: 3,
          url: 'chrome-extension://x/index.html?view=tab',
        }),
      ],
      stubMatches: [
        fakeTab({
          id: 9,
          windowId: 5,
          url: 'chrome-extension://x/pinned.html',
        }),
      ],
    });
    await openOrFocusTabView(api, request(5));
    expect(calls.updates).toEqual([{ tabId: 9, props: { active: true } }]);
    expect(calls.focusWindows).toEqual([5]);
    expect(calls.creates).toEqual([]);
  });

  test('KAN-459: a stub elsewhere still counts as existing; nothing is created', async () => {
    const { api, calls } = makeTabApi({
      stubMatches: [
        fakeTab({
          id: 9,
          windowId: 5,
          url: 'chrome-extension://x/pinned.html',
        }),
      ],
    });
    await openOrFocusTabView(api, request(2));
    expect(calls.updates).toEqual([{ tabId: 9, props: { active: true } }]);
    expect(calls.creates).toEqual([]);
  });

  test('KAN-459: a stub asked to show a dialog is sent to the full view with it, not announced to', async () => {
    const { api, calls } = makeTabApi({
      stubMatches: [
        fakeTab({
          id: 9,
          windowId: 5,
          url: 'chrome-extension://x/pinned.html',
        }),
      ],
    });
    await openOrFocusTabView(api, { ...request(5), show: 'pinGuide' });
    expect(calls.updates).toEqual([
      {
        tabId: 9,
        props: {
          active: true,
          url: 'chrome-extension://x/index.html?view=tab&show=pinGuide',
        },
      },
    ]);
    expect(calls.focusWindows).toEqual([5]);
    expect(calls.announces).toEqual([]);
  });

  test('KAN-459: a loaded full view in the asking window beats a stub in the same window', async () => {
    const { api, calls } = makeTabApi({
      matches: [
        fakeTab({
          id: 7,
          windowId: 5,
          url: 'chrome-extension://x/index.html?view=tab',
        }),
      ],
      stubMatches: [
        fakeTab({
          id: 9,
          windowId: 5,
          url: 'chrome-extension://x/pinned.html',
        }),
      ],
    });
    await openOrFocusTabView(api, request(5));
    expect(calls.updates).toEqual([{ tabId: 7, props: { active: true } }]);
  });

  test('a query rejection does not throw or reject; it is swallowed like the restore branch', async () => {
    const { api } = makeTabApi({ rejectQuery: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(openOrFocusTabView(api, request(5))).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a request to show a dialog in the full view (KAN-7)', () => {
  test('isOpenInTabRequest takes a known show and refuses an unknown one', () => {
    for (const show of ['setup', 'pinGuide']) {
      expect(
        isOpenInTabRequest({ type: OPEN_IN_TAB_MESSAGE, windowId: 1, show })
      ).toBe(true);
    }
    expect(
      isOpenInTabRequest({
        type: OPEN_IN_TAB_MESSAGE,
        windowId: 1,
        show: 'theme',
      })
    ).toBe(false);
  });

  test('isShowInFullViewMessage needs its type, a numeric tab id and a known show', () => {
    expect(
      isShowInFullViewMessage({
        type: SHOW_IN_FULL_VIEW_MESSAGE,
        tabId: 7,
        show: 'setup',
      })
    ).toBe(true);
    expect(
      isShowInFullViewMessage({
        type: SHOW_IN_FULL_VIEW_MESSAGE,
        show: 'setup',
      })
    ).toBe(false);
    expect(
      isShowInFullViewMessage({
        type: SHOW_IN_FULL_VIEW_MESSAGE,
        tabId: '7',
        show: 'setup',
      })
    ).toBe(false);
    expect(
      isShowInFullViewMessage({
        type: SHOW_IN_FULL_VIEW_MESSAGE,
        tabId: 7,
        show: 'theme',
      })
    ).toBe(false);
    expect(
      isShowInFullViewMessage({
        type: OPEN_IN_TAB_MESSAGE,
        tabId: 7,
        show: 'setup',
      })
    ).toBe(false);
    expect(isShowInFullViewMessage(null)).toBe(false);
  });

  test('no full view open: a new one is created with the request on its address', async () => {
    const { api, calls } = makeTabApi();
    await openOrFocusTabView(api, { ...request(5), show: 'setup' });
    expect(calls.creates).toEqual([
      {
        url: 'chrome-extension://x/index.html?view=tab&show=setup',
        index: 0,
        windowId: 5,
        active: true,
      },
    ]);
    expect(calls.announces).toEqual([]);
  });

  test('a full view open: it is focused, then told by tab id what to show', async () => {
    const { api, calls } = makeTabApi({
      matches: [fakeTab({ id: 7, windowId: 3 })],
    });
    await openOrFocusTabView(api, { ...request(5), show: 'pinGuide' });
    expect(calls.focusWindows).toEqual([3]);
    expect(calls.announces).toEqual([
      { type: SHOW_IN_FULL_VIEW_MESSAGE, tabId: 7, show: 'pinGuide' },
    ]);
    expect(calls.creates).toEqual([]);
  });

  test('a plain open asks nothing to be shown', async () => {
    const { api, calls } = makeTabApi({
      matches: [fakeTab({ id: 7, windowId: 3 })],
    });
    await openOrFocusTabView(api, request(5));
    expect(calls.announces).toEqual([]);
  });

  test('no page listening is logged, never thrown', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = makeTabApi({
      matches: [fakeTab({ id: 7 })],
      rejectAnnounce: true,
    });
    await expect(
      openOrFocusTabView(api, { ...request(5), show: 'setup' })
    ).resolves.toBeUndefined();
  });
});
