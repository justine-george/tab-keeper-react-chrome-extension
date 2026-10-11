import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  chromePopupApi,
  isOpenInPopupRequest,
  OPEN_IN_POPUP_MESSAGE,
  openInPopup,
  type PopupApi,
} from '../../../utils/functions/openInPopup';
import {
  chromeTabApi,
  OPEN_IN_TAB_MESSAGE,
  openOrFocusTabView,
} from '../../../utils/functions/popOut';
import { recordFullViewOrigins } from '../../../utils/functions/fullViewOrigin';
import { recordRecentTabs } from '../../../utils/functions/recentTabs';
import { DEFAULT_VIEW_KEY } from '../../../utils/functions/defaultView';
import type * as DefaultViewModule from '../../../utils/functions/defaultView';
import { setupChromeFake } from '../../setup/chrome.fake';

const VIEW = 'chrome-extension://x/index.html?view=tab';

type Entry =
  | { call: 'removeTab'; tabId: number }
  | { call: 'setPopup'; popup: string }
  | { call: 'openPopup'; windowId: number | undefined }
  | { call: 'createTab'; props: Parameters<PopupApi['createTab']>[0] }
  | { call: 'activate'; tabId: number };

interface FakeTab {
  id: number;
  windowId: number;
  index: number;
  pinned?: boolean;
}

// A hand-made browser: a window closes with its last tab, and openPopup naming a gone window rejects.
function makeApi(options: {
  tabs: FakeTab[];
  popup?: string;
  refusePopup?: boolean;
  refuseRemove?: boolean;
  refuseCreate?: boolean;
  // Refuses a create naming a window: that window closed after the check.
  refuseCreateInWindow?: boolean;
  refuseRestore?: boolean;
  // KAN-507. The tab ⤢ was pressed on, recorded for the full view 7.
  origin?: number;
  // Each window's recently used tabs, newest first.
  recent?: Record<number, number[]>;
  refuseRecords?: boolean;
  refuseActivate?: boolean;
}): { api: PopupApi; log: Entry[] } {
  const tabs = options.tabs.map((t) => ({ ...t }));
  let popup = options.popup ?? 'chrome-extension://x/index.html';
  const log: Entry[] = [];
  const windowExists = (id: number) => tabs.some((t) => t.windowId === id);
  const api: PopupApi = {
    getURL: (path) => `chrome-extension://x/${path}`,
    getTab: async (tabId) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}.`);
      return {
        index: tab.index,
        pinned: tab.pinned ?? false,
        windowId: tab.windowId,
      };
    },
    normalTabIds: async () => tabs.map((t) => t.id),
    removeTab: async (tabId) => {
      log.push({ call: 'removeTab', tabId });
      if (options.refuseRemove) throw new Error('remove refused');
      tabs.splice(
        tabs.findIndex((t) => t.id === tabId),
        1
      );
    },
    windowExists: async (id) => windowExists(id),
    getPopup: async () => popup,
    setPopup: async (next) => {
      log.push({ call: 'setPopup', popup: next });
      if (next === '' && options.refuseRestore) {
        throw new Error('setPopup refused');
      }
      popup = next;
    },
    openPopup: async (windowId) => {
      log.push({ call: 'openPopup', windowId });
      if (windowId !== undefined && !windowExists(windowId)) {
        throw new Error(`No window with id: ${windowId}.`);
      }
      if (options.refusePopup) throw new Error('Failed to open popup.');
    },
    createTab: async (props) => {
      log.push({ call: 'createTab', props });
      if (options.refuseCreate) throw new Error('create refused');
      if (options.refuseCreateInWindow && props.windowId !== undefined) {
        throw new Error(`No window with id: ${props.windowId}.`);
      }
    },
    originOf: async ({ tabId }) => {
      if (options.refuseRecords) throw new Error('storage refused');
      return tabId === 7 ? options.origin : undefined;
    },
    recentTabsIn: async (windowId) => {
      if (options.refuseRecords) throw new Error('storage refused');
      return options.recent?.[windowId] ?? [];
    },
    activate: async (tabId) => {
      log.push({ call: 'activate', tabId });
      if (options.refuseActivate) throw new Error('activate refused');
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}.`);
      return tab.windowId;
    },
  };
  return { api, log };
}

// The full view (7) at index 1 of window 1, beside tab 6; window 2 holds tab 20.
const BESIDE: FakeTab[] = [
  { id: 6, windowId: 1, index: 0 },
  { id: 7, windowId: 1, index: 1 },
  { id: 20, windowId: 2, index: 0 },
];
// The full view alone in window 1; window 2 holds tab 20.
const ALONE: FakeTab[] = [
  { id: 7, windowId: 1, index: 0 },
  { id: 20, windowId: 2, index: 0 },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isOpenInPopupRequest', () => {
  test('accepts the open-in-popup request', () => {
    expect(isOpenInPopupRequest({ type: OPEN_IN_POPUP_MESSAGE })).toBe(true);
  });

  test('rejects the open-in-tab request, other values and null', () => {
    expect(
      isOpenInPopupRequest({ type: OPEN_IN_TAB_MESSAGE, windowId: 1 })
    ).toBe(false);
    expect(isOpenInPopupRequest('openInPopup')).toBe(false);
    expect(isOpenInPopupRequest(null)).toBe(false);
    expect(isOpenInPopupRequest(undefined)).toBe(false);
  });
});

describe('openInPopup (KAN-437)', () => {
  test('beside other tabs: closes the full view first, then opens the popup over its window', async () => {
    const { api, log } = makeApi({ tabs: BESIDE });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: 1 },
    ]);
  });

  test('alone in its window, with another window open: opens the popup naming no window', async () => {
    const { api, log } = makeApi({ tabs: ALONE });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: undefined },
    ]);
  });

  test('pinned: keeps the tab and opens the popup over its window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: [
        { id: 7, windowId: 1, index: 0, pinned: true },
        ...BESIDE.slice(2),
      ],
    });

    await openInPopup(api, 7);

    expect(log).toEqual([{ call: 'openPopup', windowId: 1 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('the only tab of the only normal window: keeps it and opens the popup over it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: [{ id: 7, windowId: 1, index: 0 }] });

    await openInPopup(api, 7);

    expect(log).toEqual([{ call: 'openPopup', windowId: 1 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('Chrome refuses after the close: reopens the full view at its index in its window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: BESIDE, refusePopup: true });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: 1 },
      {
        call: 'createTab',
        props: { url: VIEW, active: true, windowId: 1, index: 1 },
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      'No popup opened; reopening the full view:',
      expect.any(Error)
    );
  });

  test('Chrome refuses after its window closed: reopens letting Chrome choose', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: ALONE, refusePopup: true });

    await openInPopup(api, 7);

    expect(log[log.length - 1]).toEqual({
      call: 'createTab',
      props: { url: VIEW, active: true },
    });
  });

  test('Chrome refuses, then the window closes before the reopen: reopens letting Chrome choose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: BESIDE,
      refusePopup: true,
      refuseCreateInWindow: true,
    });

    await openInPopup(api, 7);

    expect(log.slice(-2)).toEqual([
      {
        call: 'createTab',
        props: { url: VIEW, active: true, windowId: 1, index: 1 },
      },
      { call: 'createTab', props: { url: VIEW, active: true } },
    ]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'No popup opened; reopening the full view:',
    ]);
  });

  test('Chrome refuses a kept tab: the tab stays, nothing reopens, and it warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: [{ id: 7, windowId: 1, index: 0, pinned: true }],
      refusePopup: true,
    });

    await openInPopup(api, 7);

    expect(log).toEqual([{ call: 'openPopup', windowId: 1 }]);
    expect(warn).toHaveBeenCalledWith(
      'Could not open the popup:',
      expect.any(Error)
    );
  });

  test('not sent from a tab: opens the popup and closes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: BESIDE });

    await openInPopup(api, undefined);

    expect(log).toEqual([{ call: 'openPopup', windowId: undefined }]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('Default view Full: sets the popup for this open, then puts it back', async () => {
    const { api, log } = makeApi({ tabs: BESIDE, popup: '' });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'removeTab', tabId: 7 },
      { call: 'setPopup', popup: 'index.html' },
      { call: 'openPopup', windowId: 1 },
      { call: 'setPopup', popup: '' },
    ]);
  });

  test('Default view Full and Chrome refuses: puts the popup back, then reopens', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: BESIDE,
      popup: '',
      refusePopup: true,
    });

    await openInPopup(api, 7);

    expect(log.map((e) => e.call)).toEqual([
      'removeTab',
      'setPopup',
      'openPopup',
      'setPopup',
      'createTab',
    ]);
  });

  test('CONTROL: Default view Compact never touches the popup setting', async () => {
    const { api, log } = makeApi({ tabs: BESIDE });

    await openInPopup(api, 7);

    expect(log.filter((e) => e.call === 'setPopup')).toEqual([]);
  });

  test('a refused put-back warns, and the popup that opened is not undone by a reopen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: BESIDE,
      popup: '',
      refuseRestore: true,
    });

    await openInPopup(api, 7);

    expect(log.filter((e) => e.call === 'createTab')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'Could not restore the default view:',
      expect.any(Error)
    );
  });

  test('never rejects: the tab is already gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: ALONE.slice(1) });

    await expect(openInPopup(api, 7)).resolves.toBeUndefined();

    expect(log).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'Could not open the popup:',
      expect.any(Error)
    );
  });

  test('never rejects: the close is refused, and no popup is opened', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: BESIDE, refuseRemove: true });

    await expect(openInPopup(api, 7)).resolves.toBeUndefined();

    expect(log).toEqual([{ call: 'removeTab', tabId: 7 }]);
  });

  test('never rejects: the popup, the reopen and its retry are all refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: BESIDE,
      refusePopup: true,
      refuseCreate: true,
    });

    await expect(openInPopup(api, 7)).resolves.toBeUndefined();

    expect(log.filter((entry) => entry.call === 'createTab')).toHaveLength(2);

    expect(warn).toHaveBeenLastCalledWith(
      'Could not open the popup:',
      expect.any(Error)
    );
  });
});

describe('KAN-507: back to the tab the full view was opened from', () => {
  test('origin beside it: that tab first, then the full view closes, then the popup opens over it', async () => {
    const { api, log } = makeApi({ tabs: BESIDE, origin: 6 });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'activate', tabId: 6 },
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: 1 },
    ]);
  });

  test('origin in another window: that window’s tab, and the popup opens there', async () => {
    const { api, log } = makeApi({ tabs: ALONE, origin: 20 });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'activate', tabId: 20 },
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: 2 },
    ]);
  });

  test('pinned: goes back to the origin and the pinned tab stays', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 6, windowId: 1, index: 1 },
        { id: 7, windowId: 1, index: 0, pinned: true },
        { id: 20, windowId: 2, index: 0 },
      ],
      origin: 20,
    });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'activate', tabId: 20 },
      { call: 'openPopup', windowId: 2 },
    ]);
  });

  test('origin closed meanwhile: the last tab used beside the full view instead', async () => {
    const { api, log } = makeApi({
      tabs: BESIDE,
      origin: 99,
      recent: { 1: [7, 98, 6] },
    });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'activate', tabId: 6 },
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: 1 },
    ]);
  });

  test('no origin recorded (the full view was reached without ⤢): the last tab used beside it', async () => {
    const { api, log } = makeApi({
      tabs: [...BESIDE, { id: 5, windowId: 1, index: 2 }],
      recent: { 1: [7, 5, 6], 2: [20] },
    });

    await openInPopup(api, 7);

    expect(log[0]).toEqual({ call: 'activate', tabId: 5 });
  });

  test('the records cannot be read: as before KAN-507, and it warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({ tabs: BESIDE, refuseRecords: true });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: 1 },
    ]);
    expect(warn).toHaveBeenCalledWith(
      'Could not read where to go back to:',
      expect.any(Error)
    );
  });

  test('Chrome refuses the switch: as before KAN-507, and it warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: ALONE,
      origin: 20,
      refuseActivate: true,
    });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'activate', tabId: 20 },
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: undefined },
    ]);
    expect(warn).toHaveBeenCalledWith(
      'Could not go back to the tab:',
      expect.any(Error)
    );
  });

  test('Chrome refuses the popup after going back: the full view reopens where it was', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: BESIDE,
      origin: 6,
      refusePopup: true,
    });

    await openInPopup(api, 7);

    expect(log).toEqual([
      { call: 'activate', tabId: 6 },
      { call: 'removeTab', tabId: 7 },
      { call: 'openPopup', windowId: 1 },
      {
        call: 'createTab',
        props: { url: VIEW, active: true, windowId: 1, index: 1 },
      },
    ]);
  });
});

describe('chromePopupApi against the chrome fake (KAN-437)', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });
  const FAKE_VIEW = 'chrome-extension://faketestid/index.html?view=tab';
  // openPopupCalls logs refused calls too; every refusal path warns, so no warning means the popup opened.
  const silenceWarn = () =>
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  test('beside another tab: closes the full view, then opens the popup over its window', async () => {
    const warn = silenceWarn();
    handle = setupChromeFake({
      action: {},
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, url: 'https://a.test/' },
            { id: 12, url: FAKE_VIEW, active: true },
          ],
        },
        { id: 2, tabs: [{ id: 21, url: 'https://b.test/' }] },
      ],
    });

    await openInPopup(chromePopupApi, 12);

    expect(handle.removedTabIds).toEqual([12]);
    expect(handle.openPopupCalls).toEqual([
      { windowId: 1, popup: 'index.html' },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('alone in its window: the window closes with it, and the popup names no window', async () => {
    const warn = silenceWarn();
    handle = setupChromeFake({
      action: {},
      windows: [
        { id: 1, focused: true, tabs: [{ id: 12, url: FAKE_VIEW }] },
        { id: 2, tabs: [{ id: 21, url: 'https://b.test/' }] },
      ],
    });

    await openInPopup(chromePopupApi, 12);

    expect(handle.removedTabIds).toEqual([12]);
    expect(handle.openPopupCalls).toEqual([
      { windowId: undefined, popup: 'index.html' },
    ]);
    expect(handle.createdTabs).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a popup-type window does not count: the only tab of the only normal window stays', async () => {
    const warn = silenceWarn();
    handle = setupChromeFake({
      action: {},
      windows: [
        { id: 1, focused: true, tabs: [{ id: 12, url: FAKE_VIEW }] },
        { id: 2, type: 'popup', tabs: [{ id: 21, url: 'https://b.test/' }] },
      ],
    });

    await openInPopup(chromePopupApi, 12);

    expect(handle.removedTabIds).toEqual([]);
    expect(handle.openPopupCalls).toEqual([
      { windowId: 1, popup: 'index.html' },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('refused: the full view comes back at its index in its window', async () => {
    silenceWarn();
    handle = setupChromeFake({
      action: { openPopupRejects: true },
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, url: 'https://a.test/' },
            { id: 12, url: FAKE_VIEW, active: true },
            { id: 13, url: 'https://c.test/' },
          ],
        },
      ],
    });

    await openInPopup(chromePopupApi, 12);

    expect(handle.createdTabs).toEqual([
      { url: FAKE_VIEW, active: true, windowId: 1, index: 1 },
    ]);
  });

  test('Default view Full: the popup is set for the open, then put back', async () => {
    const warn = silenceWarn();
    handle = setupChromeFake({
      action: {},
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, url: 'https://a.test/' },
            { id: 12, url: FAKE_VIEW, active: true },
          ],
        },
      ],
    });
    await chrome.action.setPopup({ popup: '' });

    await openInPopup(chromePopupApi, 12);

    expect(handle.openPopupCalls).toEqual([
      { windowId: 1, popup: 'index.html' },
    ]);
    expect(await chrome.action.getPopup({})).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  test('Default view Full and the popup cannot be set: the full view comes back, the setting stays', async () => {
    const warn = silenceWarn();
    const action: { setPopupRejects?: boolean } = {};
    handle = setupChromeFake({
      action,
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, url: 'https://a.test/' },
            { id: 12, url: FAKE_VIEW, active: true },
          ],
        },
      ],
    });
    await chrome.action.setPopup({ popup: '' });
    // The fake reads setPopupRejects at each call, so Chrome refuses only from here on.
    action.setPopupRejects = true;

    await openInPopup(chromePopupApi, 12);

    expect(handle.removedTabIds).toEqual([12]);
    expect(handle.openPopupCalls).toEqual([]);
    expect(handle.createdTabs).toEqual([
      { url: FAKE_VIEW, active: true, windowId: 1, index: 1 },
    ]);
    expect(await chrome.action.getPopup({})).toBe('');
    expect(warn).toHaveBeenCalledWith(
      'No popup opened; reopening the full view:',
      expect.any(Error)
    );
  });
});

// R9. Chrome sleeps the worker after ~30s idle, so a press usually starts it, and its startup reapply runs beside the press.
describe('the worker runs a press after its startup reapply (KAN-437)', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  test("Default view Full: a press during the reapply waits, so the reapply's '' cannot land inside the open", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handle = setupChromeFake({
      action: {},
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://a.test/' }] },
      ],
    });
    await chrome.storage.local.set({ [DEFAULT_VIEW_KEY]: 'full' });
    await chrome.action.setPopup({ popup: '' });
    // The startup reapply, held until the press has been sent.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.resetModules();
    vi.doMock(
      '../../../utils/functions/defaultView',
      async (importOriginal) => {
        const original = await importOriginal<typeof DefaultViewModule>();
        return {
          ...original,
          reapplyDefaultView: async (
            ...args: Parameters<typeof original.reapplyDefaultView>
          ) => {
            await held;
            return original.reapplyDefaultView(...args);
          },
        };
      }
    );
    try {
      await import('../../../background');
    } finally {
      vi.doUnmock('../../../utils/functions/defaultView');
    }

    await chrome.runtime.sendMessage({ type: OPEN_IN_POPUP_MESSAGE });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // PREMISE: the reapply has not written yet.
    expect(handle.popupsSet).toEqual(['']);
    expect(handle.openPopupCalls).toEqual([]);

    release();

    await vi.waitFor(() =>
      expect(handle?.popupsSet).toEqual(['', '', 'index.html', ''])
    );
    expect(handle.openPopupCalls).toEqual([
      { windowId: undefined, popup: 'index.html' },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('KAN-507 against the chrome fake: ⤢, then Open compact view', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });
  const FAKE_VIEW = 'chrome-extension://faketestid/index.html?view=tab';
  const activeIn = async (windowId: number) =>
    (await chrome.tabs.query({ active: true, windowId }))[0]?.id;
  // ⤢ from a window: the worker opens or focuses the full view; resolves to its tab id.
  const pressOpenFullView = async (windowId: number) => {
    await openOrFocusTabView(chromeTabApi, {
      type: OPEN_IN_TAB_MESSAGE,
      windowId,
    });
    const [fullView] = await chrome.tabs.query({ url: `${FAKE_VIEW}*` });
    if (fullView?.id === undefined) throw new Error('no full view');
    return fullView.id;
  };
  // Chrome would land on 11, the full view's right-hand neighbour, if nothing chose for it.
  const THREE_TABS = [
    { id: 11, url: 'https://a.test/' },
    { id: 12, url: 'https://b.test/', active: true },
    { id: 13, url: 'https://c.test/' },
  ];

  test('lands back on the tab ⤢ was pressed on, not on the full view’s neighbour', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handle = setupChromeFake({
      action: {},
      windows: [{ id: 1, focused: true, tabs: THREE_TABS }],
    });
    recordRecentTabs();
    recordFullViewOrigins();

    const fullView = await pressOpenFullView(1);
    await openInPopup(chromePopupApi, fullView);

    expect(await activeIn(1)).toBe(12);
    expect(handle.removedTabIds).toEqual([fullView]);
    expect(handle.openPopupCalls).toEqual([
      { windowId: 1, popup: 'index.html' },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a visit to another tab in between: lands on the last tab used, not the stale origin', async () => {
    handle = setupChromeFake({
      action: {},
      windows: [{ id: 1, focused: true, tabs: THREE_TABS }],
    });
    recordRecentTabs();
    recordFullViewOrigins();

    const fullView = await pressOpenFullView(1);
    handle.browser.activateTab(13);
    handle.browser.activateTab(fullView);
    await openInPopup(chromePopupApi, fullView);

    expect(await activeIn(1)).toBe(13);
    expect(handle.removedTabIds).toEqual([fullView]);
  });

  test('⤢ jumped to a pinned full view in another window: back in the first window, the pinned tab stays', async () => {
    handle = setupChromeFake({
      action: {},
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: FAKE_VIEW, pinned: true, active: true },
            { id: 11, url: 'https://a.test/' },
          ],
        },
        {
          id: 2,
          focused: true,
          tabs: [{ id: 21, url: 'https://b.test/', active: true }],
        },
      ],
    });
    recordRecentTabs();
    recordFullViewOrigins();

    const fullView = await pressOpenFullView(2);
    expect(fullView).toBe(10);
    // PREMISE: ⤢ moved the user to window 1.
    expect((await chrome.windows.getLastFocused()).id).toBe(1);
    await openInPopup(chromePopupApi, fullView);

    expect((await chrome.windows.getLastFocused()).id).toBe(2);
    expect(handle.removedTabIds).toEqual([]);
    expect(handle.openPopupCalls).toEqual([
      { windowId: 2, popup: 'index.html' },
    ]);
  });
});
