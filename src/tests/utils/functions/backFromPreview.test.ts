import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  isReturnFromPreviewRequest,
  requestReturnFromPreview,
  returnFromPreview,
  RETURN_FROM_PREVIEW_MESSAGE,
  type PreviewBackApi,
} from '../../../utils/functions/backFromPreview';
import { tabKeeperPageOf } from '../../../utils/functions/pinnedTabKeeper';

type Entry =
  | { call: 'activate'; tabId: number }
  | { call: 'removeTab'; tabId: number }
  | { call: 'openPopup'; windowId: number | undefined }
  | { call: 'openFullView'; windowId: number | undefined };

interface FakeTab {
  id: number;
  windowId: number;
  opener?: number;
  url?: string;
}

const EXT = 'chrome-extension://x/';
const FULL_VIEW_URL = `${EXT}index.html?view=tab`;
const STUB_URL = `${EXT}pinned.html`;

// A hand-made browser: a window closes with its last tab; the log is the call order.
function makeApi(options: {
  tabs: FakeTab[];
  popup?: string;
  noPopupSupport?: boolean;
  refusePopup?: boolean;
  refuseActivate?: boolean;
  refuseGetTab?: boolean;
  fullViewOpensNothing?: boolean;
}): { api: PreviewBackApi; log: Entry[] } {
  const tabs = options.tabs.map((t) => ({ ...t }));
  const log: Entry[] = [];
  const windowExists = (id: number) => tabs.some((t) => t.windowId === id);
  const api: PreviewBackApi = {
    getURL: (path) => `${EXT}${path}`,
    getTab: async (tabId) => {
      if (options.refuseGetTab) throw new Error('getTab refused');
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}.`);
      return { index: 0, pinned: false, windowId: tab.windowId };
    },
    normalTabIds: async () => tabs.map((t) => t.id),
    removeTab: async (tabId) => {
      log.push({ call: 'removeTab', tabId });
      tabs.splice(
        tabs.findIndex((t) => t.id === tabId),
        1
      );
    },
    windowExists: async (id) => windowExists(id),
    getPopup: async () => options.popup ?? 'chrome-extension://x/index.html',
    setPopup: async () => undefined,
    openPopup: async (windowId) => {
      log.push({ call: 'openPopup', windowId });
      if (options.refusePopup) throw new Error('Failed to open popup.');
    },
    createTab: async () => undefined,
    originOf: async () => undefined,
    recentTabsIn: async () => [],
    activate: async (tabId) => {
      log.push({ call: 'activate', tabId });
      if (options.refuseActivate) throw new Error('activate refused');
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}.`);
      return tab.windowId;
    },
    openerOf: async (tabId) => {
      const opener = tabs.find((t) => t.id === tabId)?.opener;
      return tabs.some((t) => t.id === opener) ? opener : undefined;
    },
    isTabKeeperTab: async (tabId) => {
      const tab = tabs.find((t) => t.id === tabId);
      return (
        tab !== undefined &&
        tabKeeperPageOf({ url: tab.url }, api.getURL) !== undefined
      );
    },
    canOpenPopup: () => !options.noPopupSupport,
    openFullView: async (windowId) => {
      log.push({ call: 'openFullView', windowId });
      if (options.fullViewOpensNothing) return;
      tabs.push({ id: 100 + tabs.length, windowId: windowId ?? 1 });
    },
  };
  return { api, log };
}

const PREVIEW = 9;

afterEach(() => vi.restoreAllMocks());

describe('isReturnFromPreviewRequest', () => {
  test('accepts both routes and nothing else', () => {
    const type = RETURN_FROM_PREVIEW_MESSAGE;
    expect(isReturnFromPreviewRequest({ type, from: 'full' })).toBe(true);
    expect(isReturnFromPreviewRequest({ type, from: 'popup' })).toBe(true);
    expect(isReturnFromPreviewRequest({ type, from: 'x' })).toBe(false);
    expect(isReturnFromPreviewRequest({ type })).toBe(false);
    expect(isReturnFromPreviewRequest({ type: 'openInPopup' })).toBe(false);
    expect(isReturnFromPreviewRequest(null)).toBe(false);
  });
});

describe('returnFromPreview', () => {
  test('no sender tab: nothing is called', async () => {
    const { api, log } = makeApi({ tabs: [{ id: 1, windowId: 1 }] });
    await returnFromPreview(api, undefined, 'full');
    await returnFromPreview(api, undefined, 'popup');
    expect(log).toEqual([]);
  });

  test('full, opener open: switch to it, then close the preview', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1, url: FULL_VIEW_URL },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'full');
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'removeTab', tabId: PREVIEW },
    ]);
  });

  test('full, opener gone: a full view opens in the preview window, then the preview closes', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: PREVIEW, windowId: 2, opener: 77 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'full');
    expect(log).toEqual([
      { call: 'openFullView', windowId: 2 },
      { call: 'removeTab', tabId: PREVIEW },
    ]);
  });

  test('full, the switch fails: treated as opener gone', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1, url: FULL_VIEW_URL },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
      refuseActivate: true,
    });
    await returnFromPreview(api, PREVIEW, 'full');
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'openFullView', windowId: 2 },
      { call: 'removeTab', tabId: PREVIEW },
    ]);
  });

  test('full, opener handed on to a web page: a full view opens, then the preview closes', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1, url: 'https://travel.example/' },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'full');
    expect(log).toEqual([
      { call: 'openFullView', windowId: 2 },
      { call: 'removeTab', tabId: PREVIEW },
    ]);
  });

  test('full, opener is the pinned stub: switch to it, then close the preview', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1, url: STUB_URL },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'full');
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'removeTab', tabId: PREVIEW },
    ]);
  });

  test('full, the preview is the only normal tab: the full view opens before it closes', async () => {
    const { api, log } = makeApi({
      tabs: [{ id: PREVIEW, windowId: 2, opener: 1 }],
    });
    await returnFromPreview(api, PREVIEW, 'full');
    expect(log).toEqual([
      { call: 'openFullView', windowId: 2 },
      { call: 'removeTab', tabId: PREVIEW },
    ]);
  });

  test('full, the preview is the only normal tab and no full view opens: the preview stays', async () => {
    const { api, log } = makeApi({
      tabs: [{ id: PREVIEW, windowId: 2, opener: 1 }],
      fullViewOpensNothing: true,
    });
    await returnFromPreview(api, PREVIEW, 'full');
    expect(log).toEqual([{ call: 'openFullView', windowId: 2 }]);
  });

  test('popup, opener is a web page: switch to it all the same', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1, url: 'https://travel.example/' },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'removeTab', tabId: PREVIEW },
      { call: 'openPopup', windowId: 1 },
    ]);
  });

  test('popup, opener open: switch, close, then the popup in the window switched to', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'removeTab', tabId: PREVIEW },
      { call: 'openPopup', windowId: 1 },
    ]);
  });

  test('popup, opener gone: close, then the popup over the preview window if it is left', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: 5, windowId: 2 },
        { id: PREVIEW, windowId: 2, opener: 77 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'removeTab', tabId: PREVIEW },
      { call: 'openPopup', windowId: 2 },
    ]);
  });

  test('popup, opener gone and the preview was alone in its window: the popup goes where Chrome chooses', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: PREVIEW, windowId: 2, opener: 77 },
      ],
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'removeTab', tabId: PREVIEW },
      { call: 'openPopup', windowId: undefined },
    ]);
  });

  test('popup, the switch fails: treated as opener gone', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
      refuseActivate: true,
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'removeTab', tabId: PREVIEW },
      { call: 'openPopup', windowId: undefined },
    ]);
  });

  test('popup, the preview is the only normal tab: it stays and the popup opens over it', async () => {
    const { api, log } = makeApi({
      tabs: [{ id: PREVIEW, windowId: 2, opener: 1 }],
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([{ call: 'openPopup', windowId: 2 }]);
  });

  test('popup, Chrome cannot open one: switch and close only', async () => {
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
      noPopupSupport: true,
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'removeTab', tabId: PREVIEW },
    ]);
  });

  test('popup, Chrome cannot open one and the preview is the last tab: it stays and the full view opens over it', async () => {
    const { api, log } = makeApi({
      tabs: [{ id: PREVIEW, windowId: 2, opener: 1 }],
      noPopupSupport: true,
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([{ call: 'openFullView', windowId: 2 }]);
  });

  test('popup refused: logged, the full view opens after the close, and it resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: PREVIEW, windowId: 2, opener: 1 },
      ],
      refusePopup: true,
    });
    await expect(returnFromPreview(api, PREVIEW, 'popup')).resolves.toBe(
      undefined
    );
    expect(log).toEqual([
      { call: 'activate', tabId: 1 },
      { call: 'removeTab', tabId: PREVIEW },
      { call: 'openPopup', windowId: 1 },
      { call: 'openFullView', windowId: 1 },
    ]);
    expect(warn).toHaveBeenCalled();
  });

  test('popup refused, the preview is the last tab: the full view opens over it, and it stays', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: [{ id: PREVIEW, windowId: 2, opener: 1 }],
      refusePopup: true,
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'openPopup', windowId: 2 },
      { call: 'openFullView', windowId: 2 },
    ]);
  });

  test('popup refused, no opener and the preview was alone in its window: the full view opens where Chrome chooses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, log } = makeApi({
      tabs: [
        { id: 1, windowId: 1 },
        { id: PREVIEW, windowId: 2 },
      ],
      refusePopup: true,
    });
    await returnFromPreview(api, PREVIEW, 'popup');
    expect(log).toEqual([
      { call: 'removeTab', tabId: PREVIEW },
      { call: 'openPopup', windowId: undefined },
      { call: 'openFullView', windowId: undefined },
    ]);
  });

  test.each(['full', 'popup'] as const)(
    '%s, an api call rejecting: logged, and it resolves',
    async (from) => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { api, log } = makeApi({
        tabs: [
          { id: 1, windowId: 1 },
          { id: PREVIEW, windowId: 2, opener: 1 },
        ],
        refuseGetTab: true,
      });
      await expect(returnFromPreview(api, PREVIEW, from)).resolves.toBe(
        undefined
      );
      expect(log).toEqual([]);
      expect(warn).toHaveBeenCalled();
    }
  );
});

describe('requestReturnFromPreview', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends the request and says true once it is sent', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await expect(requestReturnFromPreview('popup')).resolves.toBe(true);

    expect(sendMessage).toHaveBeenCalledWith({
      type: RETURN_FROM_PREVIEW_MESSAGE,
      from: 'popup',
    });
  });

  test('says false, logged, when the send fails; never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('gone')) },
    });

    await expect(requestReturnFromPreview('full')).resolves.toBe(false);

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
