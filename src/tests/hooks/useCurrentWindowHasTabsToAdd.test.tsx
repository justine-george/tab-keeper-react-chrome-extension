import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import {
  ADDABLE_REFRESH_COALESCE_MS,
  useCurrentWindowHasTabsToAdd,
} from '../../hooks/useCurrentWindowHasTabsToAdd';
import { buildChromeTab } from '../fixtures/chromeTab';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';

// KAN-886. Whether the current window holds anything but Tab Keeper, kept live.
let handle: ChromeFakeHandle | undefined;

function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html?view=tab');
  scratch.restore();
  return url;
}

// Read once, before any test installs its own fake: tabViewUrl restores the global.
const TAB_VIEW_URL = tabViewUrl();
const TAB_VIEW_ID = 10;
const REAL_ID = 11;

// Window 1 is the current one (the fake's getCurrent answers windows[0]).
function seed(withRealTab: boolean): ChromeSeed {
  return {
    currentTabId: TAB_VIEW_ID,
    windows: [
      {
        id: 1,
        tabs: [
          { id: TAB_VIEW_ID, url: TAB_VIEW_URL, title: 'Tab Keeper' },
          ...(withRealTab
            ? [{ id: REAL_ID, url: 'https://a.test/', title: 'A' }]
            : []),
        ],
      },
      { id: 2, tabs: [{ id: 20, url: 'https://b.test/', title: 'B' }] },
    ],
  };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount(withRealTab: boolean) {
  handle = setupChromeFake(seed(withRealTab));
  return renderHook(() => useCurrentWindowHasTabsToAdd());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  handle?.restore();
  handle = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCurrentWindowHasTabsToAdd (KAN-886)', () => {
  test('starts offered before the first read settles', () => {
    const { result } = mount(false);
    expect(result.current).toBe(true);
  });

  test('only Tab Keeper in the current window: nothing to add', async () => {
    const { result } = mount(false);
    await advance(0);
    expect(result.current).toBe(false);
  });

  test('a real tab beside Tab Keeper: something to add', async () => {
    const { result } = mount(true);
    await advance(0);
    expect(result.current).toBe(true);
  });

  test('a real tab opened in that window turns it on', async () => {
    const { result } = mount(false);
    await advance(0);
    act(() => {
      handle!.browser.openTab(1, { url: 'https://c.test/' });
    });
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(true);
  });

  test('its last real tab closed turns it off', async () => {
    const { result } = mount(true);
    await advance(0);
    act(() => handle!.browser.closeTab(REAL_ID));
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(false);
  });

  test('its last real tab moved to another window turns it off', async () => {
    const { result } = mount(true);
    await advance(0);
    act(() => handle!.browser.moveTabToWindow(REAL_ID, 2));
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(false);
  });

  test('a tab moved in from another window turns it on', async () => {
    const { result } = mount(false);
    await advance(0);
    act(() => handle!.browser.moveTabToWindow(20, 1));
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(true);
  });

  test('its real tab navigated to a Tab Keeper page turns it off', async () => {
    const { result } = mount(true);
    await advance(0);
    act(() => handle!.browser.updateTab(REAL_ID, { url: TAB_VIEW_URL }));
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(false);
  });

  // Chrome from here on answers the window with Tab Keeper alone, as after a swap or a change this page missed.
  const answerTabKeeperAlone = () => {
    const real = chrome.windows.getCurrent.bind(chrome.windows);
    vi.spyOn(chrome.windows, 'getCurrent').mockImplementation(
      async (info?: chrome.windows.QueryOptions) => {
        const win = await real(info);
        return { ...win, tabs: win.tabs?.filter((t) => t.id === TAB_VIEW_ID) };
      }
    );
  };

  test('a tab swapped by Chrome (onReplaced) is read again', async () => {
    const { result } = mount(true);
    await advance(0);
    answerTabKeeperAlone();
    act(() => handle!.browser.replaceTab(REAL_ID, 99));
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(false);
  });

  test('focusing the page reads it again', async () => {
    const { result } = mount(true);
    await advance(0);
    answerTabKeeperAlone();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(false);
  });

  test('an older read settling last does not win', async () => {
    handle = setupChromeFake(seed(false));
    const real = chrome.windows.getCurrent.bind(chrome.windows);
    let releaseFirst: () => void = () => {};
    let calls = 0;
    vi.spyOn(chrome.windows, 'getCurrent').mockImplementation(
      (info?: chrome.windows.QueryOptions) => {
        calls += 1;
        if (calls > 1) return real(info);
        // The first read answers late, with a real tab the window no longer has.
        return new Promise<chrome.windows.Window>((resolve) => {
          releaseFirst = () =>
            void real(info).then((win) =>
              resolve({
                ...win,
                tabs: [buildChromeTab({ id: 5, url: 'https://late.test/' })],
              })
            );
        });
      }
    );
    const { result } = renderHook(() => useCurrentWindowHasTabsToAdd());
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(false);
    await act(async () => {
      releaseFirst();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(false);
  });

  test('a failed read keeps "nothing to add"', async () => {
    const { result } = mount(false);
    await advance(0);
    vi.spyOn(chrome.windows, 'getCurrent').mockRejectedValueOnce(
      new Error('No current window')
    );
    act(() => {
      handle!.browser.openTab(1, { url: 'https://c.test/' });
    });
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(false);
  });

  test('a failed read keeps "something to add"', async () => {
    const { result } = mount(true);
    await advance(0);
    vi.spyOn(chrome.windows, 'getCurrent').mockRejectedValueOnce(
      new Error('No current window')
    );
    act(() => handle!.browser.closeTab(REAL_ID));
    await advance(ADDABLE_REFRESH_COALESCE_MS);
    expect(result.current).toBe(true);
  });

  test('unmount detaches every listener', () => {
    handle = setupChromeFake(seed(false));
    const before = handle.liveEventListenerCount();
    const { unmount } = renderHook(() => useCurrentWindowHasTabsToAdd());
    expect(handle.liveEventListenerCount()).toBeGreaterThan(before);
    unmount();
    expect(handle.liveEventListenerCount()).toBe(before);
  });
});
