import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  applyDefaultView,
  openFullViewFromToolbar,
  popupFor,
  reapplyDefaultView,
  type ActionApi,
  type DefaultViewStore,
} from '../../../utils/functions/defaultView';
import type { TabApi } from '../../../utils/functions/popOut';
import { buildChromeTab } from '../../fixtures/chromeTab';

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
  const focused: number[] = [];
  const api: TabApi = {
    getURL: (path) => `chrome-extension://x/${path}`,
    query: async () => open,
    update: async () => undefined,
    focusWindow: async (windowId) => {
      focused.push(windowId);
      return undefined;
    },
    create: async (props) => {
      creates.push(props);
      return undefined;
    },
    announce: async () => undefined,
  };
  return { api, creates, focused };
};

afterEach(() => vi.restoreAllMocks());

describe('popupFor', () => {
  test('compact keeps the popup; full removes it so a click reaches onClicked', () => {
    expect(popupFor('compact')).toBe('index.html');
    expect(popupFor('full')).toBe('');
  });
});

describe('applyDefaultView', () => {
  test('sets the popup for the view', async () => {
    const { api, popups } = action();
    expect(await applyDefaultView(api, 'full')).toBe(true);
    expect(popups).toEqual(['']);
  });

  test('a refused setPopup resolves false and warns; it never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = action(true);
    await expect(applyDefaultView(api, 'full')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

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

  test('with one open, focuses it and opens nothing', async () => {
    const { api, creates, focused } = tabs([
      buildChromeTab({
        id: 9,
        windowId: 2,
        url: 'chrome-extension://x/index.html?view=tab',
      }),
    ]);
    await openFullViewFromToolbar(api, { windowId: 4 });
    expect(creates).toEqual([]);
    expect(focused).toEqual([2]);
  });
});
