import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  openFullViewFromToolbar,
  reapplyDefaultView,
  type ActionApi,
  type DefaultViewStore,
} from '../../../utils/functions/defaultView';
import type { TabApi } from '../../../utils/functions/popOut';

// KAN-7 §7. The worker-side half of Default view, against recording fakes.

const action = (rejects = false) => {
  const popups: string[] = [];
  const api: ActionApi = {
    setPopup: async ({ popup }) => {
      popups.push(popup);
      if (rejects) throw new Error('refused');
    },
  };
  return { api, popups };
};

const store = (read: () => Promise<unknown>): DefaultViewStore => ({ read });

const tabs = (open: chrome.tabs.Tab[]) => {
  const creates: Parameters<TabApi['create']>[0][] = [];
  const api: TabApi = {
    getURL: (path) => `chrome-extension://x/${path}`,
    query: async () => open,
    update: async () => undefined,
    focusWindow: async () => undefined,
    create: async (props) => {
      creates.push(props);
      return { id: 99, windowId: props.windowId ?? 1 };
    },
    announce: async () => undefined,
    activeTabId: async () => undefined,
    rememberOrigin: async () => undefined,
  };
  return { api, creates };
};

afterEach(() => vi.restoreAllMocks());

describe('reapplyDefaultView (the worker at every start)', () => {
  test.each([
    ['full', ''],
    ['compact', 'index.html'],
    [undefined, 'index.html'],
    ['tab', 'index.html'],
  ])('stored %p applies popup %p', async (stored, expected) => {
    const { api, popups } = action();
    await reapplyDefaultView(
      store(async () => stored),
      api
    );
    expect(popups).toEqual([expected]);
  });

  test('an unreadable store applies compact and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, popups } = action();
    expect(
      await reapplyDefaultView(
        store(async () => {
          throw new Error('storage gone');
        }),
        api
      )
    ).toBe('compact');
    expect(popups).toEqual(['index.html']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // KAN-437 R9: the worker chains a press on this, so it must resolve even when both halves fail.
  test('an unreadable store and a refused setPopup still resolve', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = action(true);
    await expect(
      reapplyDefaultView(
        store(async () => {
          throw new Error('storage gone');
        }),
        api
      )
    ).resolves.toBe('compact');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('openFullViewFromToolbar', () => {
  test('with no full view open, opens one first in the clicked window', async () => {
    const { api, creates } = tabs([]);
    await openFullViewFromToolbar(api, { windowId: 4 });
    expect(creates).toEqual([
      {
        url: 'chrome-extension://x/index.html?view=tab',
        index: 0,
        windowId: 4,
        active: true,
      },
    ]);
  });
});
