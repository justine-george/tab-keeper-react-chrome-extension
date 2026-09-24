import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// KAN-280. Spied, not replaced: the real hold still runs, so a test can count
// how often the hook queued itself behind a held row. A duplicate queue entry
// is invisible in the read count (schedule() coalesces it away), so this count
// is the only thing that sees the queuedForRelease dedupe.
vi.mock('../../redux/dragHold', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../redux/dragHold')>();
  return { ...actual, whenDragReleases: vi.fn(actual.whenDragReleases) };
});

import {
  OPEN_NOW_REFRESH_COALESCE_MS,
  useOpenWindows,
} from '../../hooks/useOpenWindows';
import type { OpenWindow } from '../../utils/functions/openNow';
import {
  beginDragHold,
  endDragHold,
  flushHeldChanges,
  whenDragReleases,
} from '../../redux/dragHold';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';

let handle: ChromeFakeHandle | undefined;

// The tab view's own address, which isTabKeeperPage drops from the list. The
// fake's getURL is needed to spell it, and the real fake is built from a seed
// that embeds it, so a throwaway fake is installed just to read it (the same
// trick as openNow.test.ts).
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const TAB_VIEW_ID = 10;
const GROUP_ID = 500;

// Two windows; the tab view is the first tab of window 1. `pinned` and
// `audible` are seeded because the fake leaves them undefined otherwise, and
// the first-read test asserts whole OpenTab objects. `grouped` puts tab A in
// a Chrome group.
function twoWindows(
  options: { grouped?: boolean; tabGroupsApiAbsent?: boolean } = {}
): ChromeSeed {
  return {
    tabGroupsApiAbsent: options.tabGroupsApiAbsent,
    tabGroups: options.grouped
      ? [{ id: GROUP_ID, title: 'Work', color: 'blue', windowId: 1 }]
      : [],
    currentTabId: TAB_VIEW_ID,
    windows: [
      {
        id: 1,
        tabs: [
          { id: TAB_VIEW_ID, url: tabViewUrl(), title: 'Tab Keeper' },
          {
            id: 11,
            url: 'https://a.test/',
            title: 'A',
            active: true,
            pinned: false,
            audible: false,
            ...(options.grouped ? { groupId: GROUP_ID } : {}),
          },
        ],
      },
      {
        id: 2,
        tabs: [
          {
            id: 20,
            url: 'https://b.test/',
            title: 'B',
            active: true,
            pinned: true,
            audible: true,
          },
        ],
      },
    ],
  };
}

// Lets every due timer and every pending promise run, inside act() so the
// hook's state update is not flagged as happening outside React's batch.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function titlesIn(
  windows: OpenWindow[] | null,
  windowId: number
): string[] | undefined {
  return windows
    ?.find((win) => win.id === windowId)
    ?.tabs.map((tab) => tab.title);
}

function thisWindowIds(windows: OpenWindow[] | null): number[] | undefined {
  return windows?.filter((win) => win.isThisWindow).map((win) => win.id);
}

function getAllCalls(): number {
  return handle?.windowsGetAllCalls ?? 0;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  // The hold is module state; a test that failed mid-hold must not leave the
  // next one held.
  endDragHold();
  vi.mocked(whenDragReleases).mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  handle?.restore();
  handle = undefined;
});

describe('useOpenWindows', () => {
  test('first read: null until it settles, then the open windows, with the tab view tagging its window and left out', async () => {
    handle = setupChromeFake(twoWindows());

    const { result } = renderHook(() => useOpenWindows(false));
    expect(result.current).toBeNull();

    // No timer is advanced: the first read is immediate, not coalesced.
    await advance(0);

    expect(result.current).toEqual([
      {
        id: 1,
        isThisWindow: true,
        groups: [],
        tabs: [
          {
            id: 11,
            windowId: 1,
            title: 'A',
            url: 'https://a.test/',
            favIconUrl: '',
            active: true,
            pinned: false,
            audible: false,
            muted: false,
            groupId: null,
          },
        ],
      },
      {
        id: 2,
        isThisWindow: false,
        groups: [],
        tabs: [
          {
            id: 20,
            windowId: 2,
            title: 'B',
            url: 'https://b.test/',
            favIconUrl: '',
            active: true,
            pinned: true,
            audible: true,
            muted: false,
            groupId: null,
          },
        ],
      },
    ]);
    expect(getAllCalls()).toBe(1);
  });

  test('live add: a tab the browser opens is listed after the coalesce window', async () => {
    handle = setupChromeFake(twoWindows());
    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);

    handle.browser.openTab(1, { url: 'https://new.test/', title: 'New' });
    expect(titlesIn(result.current, 1)).toEqual(['A']);

    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    expect(titlesIn(result.current, 1)).toEqual(['A', 'New']);
  });

  // Review Focus 1: a page load fires many onUpdated events.
  test('a burst of 20 events in one tick causes at most two reads, and the read sees the last of them', async () => {
    handle = setupChromeFake(twoWindows());
    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);
    const afterFirstRead = getAllCalls();

    for (let i = 1; i <= 20; i += 1) {
      handle.browser.updateTab(11, { title: `A${i}` });
    }
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    const reads = getAllCalls() - afterFirstRead;
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(reads).toBeLessThanOrEqual(2);
    expect(titlesIn(result.current, 1)).toEqual(['A20']);
  });

  // KAN-279 D12: a change this page did not make waits while a row is held.
  test('drag hold: nothing is read while a row is held, and the change lands once it is released', async () => {
    handle = setupChromeFake(twoWindows());
    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);
    const afterFirstRead = getAllCalls();

    beginDragHold();
    handle.browser.openTab(1, { url: 'https://new.test/', title: 'New' });
    await advance(500);

    expect(titlesIn(result.current, 1)).toEqual(['A']);
    expect(getAllCalls()).toBe(afterFirstRead);

    endDragHold();
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    expect(titlesIn(result.current, 1)).toEqual(['A', 'New']);
  });

  test('drag hold: events spread across a hold queue the refresh behind it once, not once per event', async () => {
    handle = setupChromeFake(twoWindows());
    renderHook(() => useOpenWindows(false));
    await advance(0);

    beginDragHold();
    for (let i = 1; i <= 3; i += 1) {
      handle.browser.updateTab(11, { title: `A${i}` });
      await advance(OPEN_NOW_REFRESH_COALESCE_MS + 10);
    }

    expect(whenDragReleases).toHaveBeenCalledTimes(1);
  });

  // dropOnTop flushes the held changes BEFORE the hold ends, so the queued
  // refresh runs while the row is still held. It must wait again, not read.
  test('drag hold: a refresh flushed while the row is still held waits again, then reads on release', async () => {
    handle = setupChromeFake(twoWindows());
    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);
    const afterFirstRead = getAllCalls();

    beginDragHold();
    handle.browser.openTab(1, { url: 'https://new.test/', title: 'New' });
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);
    flushHeldChanges();
    await advance(OPEN_NOW_REFRESH_COALESCE_MS * 4);

    expect(getAllCalls()).toBe(afterFirstRead);
    expect(titlesIn(result.current, 1)).toEqual(['A']);

    endDragHold();
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    expect(titlesIn(result.current, 1)).toEqual(['A', 'New']);
  });

  // Review Focus 3: tabs.getCurrent is re-read on every refresh.
  test('the tab view dragged into another window moves the "This window" tag with it', async () => {
    handle = setupChromeFake(twoWindows());
    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);
    expect(thisWindowIds(result.current)).toEqual([1]);

    handle.browser.moveTabToWindow(TAB_VIEW_ID, 2);
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    expect(thisWindowIds(result.current)).toEqual([2]);
  });

  // Review Focus 4.
  test('groups revoked while open: the bands go and the tabs stay', async () => {
    handle = setupChromeFake(twoWindows({ grouped: true }));

    const { result, rerender } = renderHook(
      ({ showGroups }) => useOpenWindows(showGroups),
      { initialProps: { showGroups: true } }
    );
    await advance(0);
    const window1 = result.current?.find((win) => win.id === 1);
    expect(window1?.tabs[0].groupId).toBe(GROUP_ID);
    expect(window1?.groups.map((group) => group.id)).toEqual([GROUP_ID]);
    const listenersWithGroups = handle.listenerCount();

    rerender({ showGroups: false });
    await advance(0);

    const after = result.current?.find((win) => win.id === 1);
    expect(after?.tabs.map((tab) => [tab.title, tab.groupId])).toEqual([
      ['A', null],
    ]);
    expect(after?.groups).toEqual([]);
    // The four tabGroups listeners went with the permission.
    expect(handle.listenerCount()).toBe(listenersWithGroups - 4);
  });

  test('chrome.tabGroups absent (ungranted) and showGroups false: the read still succeeds', async () => {
    handle = setupChromeFake(twoWindows({ tabGroupsApiAbsent: true }));
    const warn = vi.spyOn(console, 'warn');

    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);

    expect(titlesIn(result.current, 1)).toEqual(['A']);
    expect(warn).not.toHaveBeenCalled();
  });

  // showGroups comes from a setting, chrome.tabGroups from Chrome, and
  // nothing makes them change together. If the namespace goes first, the hook
  // must not reach for it.
  test('chrome.tabGroups absent while showGroups is still true: no throw, and the tabs are listed ungrouped', async () => {
    handle = setupChromeFake(
      twoWindows({ grouped: true, tabGroupsApiAbsent: true })
    );
    const warn = vi.spyOn(console, 'warn');

    const { result } = renderHook(() => useOpenWindows(true));
    await advance(0);

    const window1 = result.current?.find((win) => win.id === 1);
    expect(window1?.tabs.map((tab) => [tab.title, tab.groupId])).toEqual([
      ['A', null],
    ]);
    expect(window1?.groups).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  // Review Focus 5: a window closed between calls makes getAll reject.
  test('a read that rejects keeps the last good snapshot, and the next event reads again', async () => {
    handle = setupChromeFake(twoWindows());
    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);
    const lastGood = result.current;
    expect(titlesIn(lastGood, 1)).toEqual(['A']);

    const gone = new Error('gone');
    vi.spyOn(chrome.windows, 'getAll').mockRejectedValueOnce(gone);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    handle.browser.openTab(1, { url: 'https://new.test/', title: 'New' });
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    expect(result.current).toBe(lastGood);
    expect(warn).toHaveBeenCalledWith(
      'Open now could not read the open windows: ',
      gone
    );

    handle.browser.updateTab(11, { title: 'A2' });
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    expect(titlesIn(result.current, 1)).toEqual(['A2', 'New']);
  });

  test('a read still in flight when showGroups changes is dropped, so it cannot put the bands back', async () => {
    handle = setupChromeFake(twoWindows({ grouped: true }));
    const { result, rerender } = renderHook(
      ({ showGroups }) => useOpenWindows(showGroups),
      { initialProps: { showGroups: true } }
    );
    await advance(0);

    // Hold the next getAll open until after the showGroups change has read.
    const snapshot = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(chrome.windows, 'getAll').mockImplementationOnce(() =>
      gate.then(() => snapshot)
    );
    handle.browser.updateTab(20, { title: 'B2' });
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    rerender({ showGroups: false });
    await advance(0);
    expect(result.current?.every((win) => win.groups.length === 0)).toBe(true);

    release();
    await advance(0);

    expect(result.current?.every((win) => win.groups.length === 0)).toBe(true);
    expect(titlesIn(result.current, 2)).toEqual(['B2']);
  });

  test('unmount removes every listener and cancels a pending refresh', async () => {
    handle = setupChromeFake(twoWindows());
    const before = handle.listenerCount();

    const { unmount } = renderHook(() => useOpenWindows(true));
    await advance(0);
    expect(handle.listenerCount()).toBeGreaterThan(before);

    // A refresh is pending when the pane goes away.
    handle.browser.updateTab(11, { title: 'A2' });
    unmount();
    const atUnmount = getAllCalls();

    expect(handle.listenerCount()).toBe(before);
    await advance(500);
    handle.browser.openTab(1, { url: 'https://new.test/', title: 'New' });
    await advance(500);
    expect(getAllCalls()).toBe(atUnmount);
  });

  // Global Constraints: live data never reaches localStorage or sync.
  test('never stored: localStorage and chrome.storage.sync are untouched by reads and live events', async () => {
    handle = setupChromeFake(twoWindows());
    localStorage.setItem('tabContainerData', '{"sentinel":true}');
    const snapshotStorage = (): [string, string | null][] => {
      const entries: [string, string | null][] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null) entries.push([key, localStorage.getItem(key)]);
      }
      return entries;
    };
    const before = snapshotStorage();
    const syncSet = vi.spyOn(chrome.storage.sync, 'set');

    const { result } = renderHook(() => useOpenWindows(false));
    await advance(0);
    handle.browser.openTab(1, { url: 'https://new.test/', title: 'New' });
    handle.browser.updateTab(11, { title: 'A2' });
    handle.browser.closeTab(20);
    await advance(OPEN_NOW_REFRESH_COALESCE_MS);

    // The events were seen, so a store would have had something to write.
    expect(titlesIn(result.current, 1)).toEqual(['A2', 'New']);
    expect(snapshotStorage()).toEqual(before);
    expect(syncSet).not.toHaveBeenCalled();
  });
});
