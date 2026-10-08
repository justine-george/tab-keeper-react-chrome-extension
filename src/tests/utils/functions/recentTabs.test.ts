import { afterEach, describe, expect, test, vi } from 'vitest';

import { captureOpenWindows } from '../../../utils/functions/capture';
import {
  RECENT_TABS_CAP,
  readRecentTabs,
  recentTabsRecorder,
  recordRecentTabs,
  withActivated,
} from '../../../utils/functions/recentTabs';
import type { SessionArea } from '../../../utils/functions/recentTabs';
import { setupChromeFake } from '../../setup/chrome.fake';
import { buildChromeTab } from '../../fixtures/chromeTab';

// KAN-458 A4. The worker's record of each window's recently activated tabs.

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const area = (): SessionArea => ({
  get: (keys) => chrome.storage.session.get(keys),
  set: (items) => chrome.storage.session.set(items),
  remove: (keys) => chrome.storage.session.remove(keys),
});
const session = () => handle?.sessionArea();

describe('withActivated', () => {
  test('newest first, no repeats', () => {
    expect(withActivated([3, 2, 1], 2)).toEqual([2, 3, 1]);
  });

  test(`keeps the newest ${RECENT_TABS_CAP}`, () => {
    const list = [1, 2, 3, 4, 5, 6, 7].reduce<number[]>(
      (acc, id) => withActivated(acc, id),
      []
    );
    expect(list).toEqual([7, 6, 5, 4, 3]);
    expect(list).toHaveLength(RECENT_TABS_CAP);
  });
});

describe('recentTabsRecorder', () => {
  test('records each activation in its own window, newest first', async () => {
    handle = setupChromeFake();
    const recorder = recentTabsRecorder(area());
    await recorder.activated({ tabId: 11, windowId: 1 });
    await recorder.activated({ tabId: 21, windowId: 2 });
    await recorder.activated({ tabId: 12, windowId: 1 });
    expect(session()).toEqual({
      'recentTabs.1': [12, 11],
      'recentTabs.2': [21],
    });
  });

  test('two activations not awaited between: neither is lost', async () => {
    handle = setupChromeFake();
    const recorder = recentTabsRecorder(area());
    void recorder.activated({ tabId: 11, windowId: 1 });
    await recorder.activated({ tabId: 12, windowId: 1 });
    expect(session()).toEqual({ 'recentTabs.1': [12, 11] });
  });

  test('a closed tab leaves its window list; others are untouched', async () => {
    handle = setupChromeFake({
      sessionArea: { 'recentTabs.1': [12, 11], 'recentTabs.2': [11] },
    });
    await recentTabsRecorder(area()).tabRemoved(11, {
      windowId: 1,
      isWindowClosing: false,
    });
    expect(session()).toEqual({
      'recentTabs.1': [12],
      'recentTabs.2': [11],
    });
  });

  test('a closed window drops its list', async () => {
    handle = setupChromeFake({
      sessionArea: { 'recentTabs.1': [12, 11], 'recentTabs.2': [21] },
    });
    const recorder = recentTabsRecorder(area());
    await recorder.tabRemoved(12, { windowId: 1, isWindowClosing: true });
    await recorder.windowRemoved(1);
    expect(session()).toEqual({ 'recentTabs.2': [21] });
  });

  test.each([
    ['not a list', 'x'],
    ['not all ids', ['x', 12]],
  ])('a malformed list (%s) is started afresh', async (_name, stored) => {
    handle = setupChromeFake({ sessionArea: { 'recentTabs.1': stored } });
    await recentTabsRecorder(area()).activated({ tabId: 11, windowId: 1 });
    expect(session()).toEqual({ 'recentTabs.1': [11] });
  });

  test('a refused write warns, and the next activation is still recorded', async () => {
    handle = setupChromeFake();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = area();
    let refuse = true;
    const recorder = recentTabsRecorder({
      ...failing,
      set: (items) =>
        refuse ? Promise.reject(new Error('quota')) : failing.set(items),
    });
    await recorder.activated({ tabId: 11, windowId: 1 });
    expect(warn).toHaveBeenCalledOnce();
    refuse = false;
    await recorder.activated({ tabId: 12, windowId: 1 });
    expect(session()).toEqual({ 'recentTabs.1': [12] });
  });
});

describe('readRecentTabs', () => {
  test("each window's list; none, or no id, is empty", async () => {
    handle = setupChromeFake({ sessionArea: { 'recentTabs.1': [12, 11] } });
    const of = await readRecentTabs([1, 2]);
    expect([of(1), of(2), of(undefined)]).toEqual([[12, 11], [], []]);
  });

  test('a failed read is no record', async () => {
    handle = setupChromeFake({ sessionArea: { 'recentTabs.1': [12] } });
    vi.spyOn(chrome.storage.session, 'get').mockRejectedValue(
      new Error('read refused')
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await readRecentTabs([1]))(1)).toEqual([]);
  });
});

describe("the worker's listeners, through to a save", () => {
  const TAB_VIEW = 'chrome-extension://faketestid/index.html?view=tab';

  test('the user on Target, then on the full view: Save stores Target, not the later tab', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            buildChromeTab({ id: 10, index: 0, url: TAB_VIEW }),
            buildChromeTab({
              id: 11,
              index: 1,
              url: 'https://t.test/',
              title: 'Target',
              active: true,
              lastAccessed: 10,
            }),
            buildChromeTab({
              id: 12,
              index: 2,
              url: 'https://b.test/',
              title: 'Background',
              lastAccessed: 20,
            }),
          ],
        },
      ],
    });
    recordRecentTabs();
    handle.browser.activateTab(11);
    handle.browser.activateTab(10);
    await vi.waitFor(() =>
      expect(session()).toEqual({ 'recentTabs.1': [10, 11] })
    );

    const captured = await captureOpenWindows('S', 'all-windows');
    const w = captured?.windows[0];
    expect(w?.tabs.find((t) => t.tabId === w.activeTabId)?.title).toBe(
      'Target'
    );
  });

  test('a closed tab and a closed window are pruned', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [buildChromeTab({ id: 11 }), buildChromeTab({ id: 12 })],
        },
        { id: 2, tabs: [buildChromeTab({ id: 21, windowId: 2 })] },
      ],
    });
    recordRecentTabs();
    handle.browser.activateTab(11);
    handle.browser.activateTab(12);
    handle.browser.activateTab(21);
    await vi.waitFor(() =>
      expect(session()).toEqual({
        'recentTabs.1': [12, 11],
        'recentTabs.2': [21],
      })
    );
    handle.browser.closeTab(12);
    handle.browser.closeWindow(2);
    await vi.waitFor(() => expect(session()).toEqual({ 'recentTabs.1': [11] }));
  });
});
