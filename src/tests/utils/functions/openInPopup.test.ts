import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  chromePopupApi,
  isOpenInPopupRequest,
  OPEN_IN_POPUP_MESSAGE,
  openInPopup,
  type PopupApi,
} from '../../../utils/functions/openInPopup';
import { OPEN_IN_TAB_MESSAGE } from '../../../utils/functions/popOut';
import { setupChromeFake } from '../../setup/chrome.fake';

const VIEW = 'chrome-extension://x/index.html?view=tab';

type Entry =
  | { call: 'removeTab'; tabId: number }
  | { call: 'setPopup'; popup: string }
  | { call: 'openPopup'; windowId: number | undefined }
  | { call: 'createTab'; props: Parameters<PopupApi['createTab']>[0] };

interface FakeTab {
  id: number;
  windowId: number;
  index: number;
  pinned?: boolean;
}

// A hand-made browser: a window closes with its last tab, and openPopup rejects as Chrome 154 measured.
function makeApi(options: {
  tabs: FakeTab[];
  popup?: string;
  refusePopup?: boolean;
  refuseRemove?: boolean;
  refuseCreate?: boolean;
  refuseRestore?: boolean;
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
    const { api, log } = makeApi({
      tabs: [
        { id: 7, windowId: 1, index: 0, pinned: true },
        ...BESIDE.slice(2),
      ],
    });

    await openInPopup(api, 7);

    expect(log).toEqual([{ call: 'openPopup', windowId: 1 }]);
  });

  test('the only tab of the only normal window: keeps it and opens the popup over it', async () => {
    const { api, log } = makeApi({ tabs: [{ id: 7, windowId: 1, index: 0 }] });

    await openInPopup(api, 7);

    expect(log).toEqual([{ call: 'openPopup', windowId: 1 }]);
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
      'Chrome refused the popup; reopening the full view:',
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
    const { api, log } = makeApi({ tabs: BESIDE });

    await openInPopup(api, undefined);

    expect(log).toEqual([{ call: 'openPopup', windowId: undefined }]);
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

  test('never rejects: the popup and the reopen are both refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = makeApi({
      tabs: BESIDE,
      refusePopup: true,
      refuseCreate: true,
    });

    await expect(openInPopup(api, 7)).resolves.toBeUndefined();

    expect(warn).toHaveBeenLastCalledWith(
      'Could not open the popup:',
      expect.any(Error)
    );
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
});
