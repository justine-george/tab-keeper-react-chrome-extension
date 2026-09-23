import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  isOpenInTabRequest,
  OPEN_IN_TAB_MESSAGE,
  openOrFocusTabView,
  OpenInTabRequest,
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
  updates: { tabId: number; props: { active: boolean } }[];
  focusWindows: number[];
  creates: {
    url: string;
    index: number;
    windowId?: number;
    active: boolean;
  }[];
};

// Hand-made TabApi fake: records every call it receives rather than
// asserting a mock was invoked, so the tests below read the actual
// arguments the implementation chose to pass.
function makeTabApi(
  options: {
    matches?: chrome.tabs.Tab[];
    rejectQuery?: boolean;
  } = {}
): { api: TabApi; calls: Calls } {
  const calls: Calls = {
    queries: [],
    updates: [],
    focusWindows: [],
    creates: [],
  };

  const api: TabApi = {
    getURL: (path) => `chrome-extension://x/${path}`,
    query: async (q) => {
      calls.queries.push(q);
      if (options.rejectQuery) throw new Error('query failed');
      return options.matches ?? [];
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
