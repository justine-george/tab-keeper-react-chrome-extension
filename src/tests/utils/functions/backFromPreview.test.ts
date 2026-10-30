import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  isReturnFromPreviewRequest,
  returnFromPreview,
  RETURN_FROM_PREVIEW_MESSAGE,
  type PreviewBackApi,
} from '../../../utils/functions/backFromPreview';

type Entry =
  | { call: 'activate'; tabId: number }
  | { call: 'removeTab'; tabId: number }
  | { call: 'openPopup'; windowId: number | undefined }
  | { call: 'openFullView'; windowId: number | undefined };

interface FakeTab {
  id: number;
  windowId: number;
  opener?: number;
}

// A hand-made browser: a window closes with its last tab; the log is the call order.
function makeApi(options: {
  tabs: FakeTab[];
  popup?: string;
  noPopupSupport?: boolean;
  refusePopup?: boolean;
  refuseActivate?: boolean;
  refuseGetTab?: boolean;
}): { api: PreviewBackApi; log: Entry[] } {
  const tabs = options.tabs.map((t) => ({ ...t }));
  const log: Entry[] = [];
  const windowExists = (id: number) => tabs.some((t) => t.windowId === id);
  const api: PreviewBackApi = {
    getURL: (path) => `chrome-extension://x/${path}`,
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
    canOpenPopup: () => !options.noPopupSupport,
    openFullView: async (windowId) => {
      log.push({ call: 'openFullView', windowId });
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
        { id: 1, windowId: 1 },
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
        { id: 1, windowId: 1 },
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
