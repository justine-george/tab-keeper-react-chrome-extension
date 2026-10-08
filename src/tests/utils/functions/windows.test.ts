import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createWindowWithRetries,
  isRestoreSessionRequest,
  planWindowClosure,
  restoreTargetIndex,
  RESTORE_SESSION_MESSAGE,
  WindowSpec,
} from '../../../utils/functions/windows';
import { generatePlaceholderURL } from '../../../utils/functions/local';
import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import { setupChromeFake } from '../../setup/chrome.fake';

// Repeated rather than imported: it is private to local.ts, and the module
// that exports it publicly pulls in window.screen, which these tests lack.
const PLACEHOLDER_URL_PREFIX = 'data:text/html;base64,';

function tab(url: string, title = 'a title') {
  return { tabId: 'id', favicon: '', title, url };
}

function spec(overrides: Partial<WindowSpec> = {}): WindowSpec {
  return {
    tabs: [tab('https://example.com')],
    focused: true,
    bounds: { height: 100, width: 200, top: 10, left: 20 },
    ...overrides,
  };
}

// chrome.windows.create hands its result to a callback, so the fake has to as
// well. `results` is read one entry per call: undefined stands for the failure
// Chrome reports by invoking the callback with no window.
function stubChrome(results: (chrome.windows.Window | undefined)[]) {
  const createdWindows: chrome.windows.CreateData[] = [];
  const createdTabs: chrome.tabs.CreateProperties[] = [];
  let call = 0;
  let nextTabId = 100;

  const chromeStub = {
    windows: {
      create: (
        options: chrome.windows.CreateData,
        callback: (window?: chrome.windows.Window) => void
      ) => {
        createdWindows.push(options);
        callback(results[call++]);
      },
    },
    tabs: {
      // createWindowWithRetries awaits this callback to learn the created
      // tab's id, so a fake that never called back would hang the promise it
      // is building rather than fail a single assertion.
      create: (
        options: chrome.tabs.CreateProperties,
        callback?: (tab?: chrome.tabs.Tab) => void
      ) => {
        createdTabs.push(options);
        callback?.({ id: nextTabId++ } as chrome.tabs.Tab);
      },
    },
  };

  vi.stubGlobal('chrome', chromeStub);
  return { createdWindows, createdTabs };
}

function fakeWindow(id: number) {
  return { id } as chrome.windows.Window;
}

describe('planWindowClosure', () => {
  test('closes every previously open window once all replacements exist', () => {
    expect(planWindowClosure([1, 2, 3], [fakeWindow(9)])).toEqual([1, 2, 3]);
  });

  test('closes nothing when any window failed to open', () => {
    expect(planWindowClosure([1, 2], [fakeWindow(9), null])).toBeNull();
  });

  test('closes nothing when a created window has no id to compare against', () => {
    const idless = {} as chrome.windows.Window;
    expect(planWindowClosure([1, 2], [fakeWindow(9), idless])).toBeNull();
  });

  test('closes nothing when no window was even attempted', () => {
    expect(planWindowClosure([1, 2], [])).toBeNull();
  });

  test('never closes a window it just created', () => {
    expect(planWindowClosure([1, 9, 2], [fakeWindow(9)])).toEqual([1, 2]);
  });

  test('returns an empty plan, not a refusal, when nothing was open', () => {
    expect(planWindowClosure([], [fakeWindow(9)])).toEqual([]);
  });
});

describe('createWindowWithRetries', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('resolves the created window and opens the remaining tabs in it', async () => {
    const { createdWindows, createdTabs } = stubChrome([fakeWindow(7)]);

    const created = await createWindowWithRetries(
      spec({
        tabs: [tab('https://first.example'), tab('https://second.example')],
      }),
      'Go to URL',
      2
    );

    expect(created).toEqual(fakeWindow(7));
    expect(createdWindows).toHaveLength(1);
    expect(createdWindows[0]).toMatchObject({
      url: 'https://first.example',
      focused: true,
      height: 100,
      width: 200,
      top: 10,
      left: 20,
    });
    // KAN-250. Every tab after the first is a placeholder that loads when
    // activated; there is no longer a setting that opens them all at once.
    expect(createdTabs).toHaveLength(1);
    expect(createdTabs[0]).toMatchObject({ windowId: 7, active: false });
    expect(createdTabs[0].url).toContain(PLACEHOLDER_URL_PREFIX);
    expect(createdTabs[0].url).not.toBe('https://second.example');
  });

  test('retries without bounds after a failed attempt', async () => {
    const { createdWindows } = stubChrome([undefined, fakeWindow(8)]);

    const created = await createWindowWithRetries(spec(), 'Go to URL', 2);

    expect(created).toEqual(fakeWindow(8));
    expect(createdWindows).toHaveLength(2);
    expect(createdWindows[0]).toMatchObject({ height: 100, width: 200 });
    expect(createdWindows[1].height).toBeUndefined();
    expect(createdWindows[1].width).toBeUndefined();
  });

  test('resolves null once the retries are spent', async () => {
    const { createdWindows } = stubChrome([undefined, undefined]);

    const created = await createWindowWithRetries(spec(), 'Go to URL', 2);

    expect(created).toBeNull();
    expect(createdWindows).toHaveLength(2);
  });

  test('creates nothing when asked for a window with no tabs', async () => {
    const { createdWindows } = stubChrome([fakeWindow(7)]);

    const created = await createWindowWithRetries(
      spec({ tabs: [] }),
      'Go to URL',
      2
    );

    expect(created).toBeNull();
    expect(createdWindows).toHaveLength(0);
  });
});

describe('createWindowWithRetries with tab groups', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  test('groups the right tabs and applies title and colour', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });

    await createWindowWithRetries(
      spec({
        tabs: [
          { ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' },
          { ...tab('https://b.test'), tabId: 't2', chromeGroupId: 'g1' },
          { ...tab('https://c.test'), tabId: 't3' },
        ],
        groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      }),
      'Go',
      2
    );

    expect(handle.groupedTabs).toHaveLength(1);
    expect(handle.groupedTabs[0].tabIds).toHaveLength(2);

    const groups = await chrome.tabGroups.query({});
    expect(groups[0]).toMatchObject({ title: 'Work', color: 'blue' });
  });

  test('an unknown colour is applied as grey rather than rejected', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });

    await createWindowWithRetries(
      spec({
        tabs: [{ ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' }],
        groups: [{ groupId: 'g1', title: 'Work', color: 'chartreuse' }],
      }),
      'Go',
      2
    );

    const groups = await chrome.tabGroups.query({});
    expect(groups[0].color).toBe('grey');
  });

  test('does no grouping at all when the permission is absent', async () => {
    handle = setupChromeFake();
    delete (globalThis as { chrome?: { tabGroups?: unknown } }).chrome!
      .tabGroups;

    await createWindowWithRetries(
      spec({
        tabs: [{ ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' }],
        groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      }),
      'Go',
      2
    );

    expect(handle.groupedTabs).toEqual([]);
  });

  // The load-bearing failure case. By the time grouping runs the tabs are
  // already open, so a grouping error must cost the groups and nothing else --
  // above all it must still resolve with the created window, because focus
  // mode decides whether to close the user's windows from that value.
  test('a failing tabs.group still resolves with the created window', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });
    const tabs = chrome.tabs as unknown as {
      group: (options: chrome.tabs.GroupOptions) => Promise<number>;
    };
    tabs.group = () => Promise.reject(new Error('nope'));

    const created = await createWindowWithRetries(
      spec({
        tabs: [{ ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' }],
        groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      }),
      'Go',
      2
    );

    expect(created).not.toBeNull();
  });

  // The try/catch inside applyTabGroups is not only there to keep the
  // rejection from escaping createWindowWithRetries (the test above): it also
  // sits INSIDE the per-group loop, so one group failing does not abandon the
  // groups after it. This is the assertion that pins that -- a plain
  // "resolves with the window" check cannot distinguish "every group but the
  // first still got applied" from "the whole loop aborted after the first
  // failure", since both leave the window intact.
  test('a group that fails does not stop the groups after it', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });
    const tabs = chrome.tabs as unknown as {
      group: (options: chrome.tabs.GroupOptions) => Promise<number>;
    };
    const originalGroup = tabs.group;
    let calls = 0;
    tabs.group = (options) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('nope'));
      return originalGroup(options);
    };

    const created = await createWindowWithRetries(
      spec({
        tabs: [
          { ...tab('https://a.test'), tabId: 't1', chromeGroupId: 'g1' },
          { ...tab('https://b.test'), tabId: 't2', chromeGroupId: 'g2' },
        ],
        groups: [
          { groupId: 'g1', title: 'First', color: 'blue' },
          { groupId: 'g2', title: 'Second', color: 'green' },
        ],
      }),
      'Go',
      2
    );

    expect(created).not.toBeNull();
    // Only the second group's tabs.group call reaches the real fake: the
    // first was intercepted and rejected before it got there.
    expect(handle.groupedTabs).toHaveLength(1);
    const groups = await chrome.tabGroups.query({});
    expect(groups.some((group) => group.title === 'Second')).toBe(true);
  });

  test('a spec with no groups behaves exactly as before', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });

    const created = await createWindowWithRetries(spec(), 'Go', 2);

    expect(created).not.toBeNull();
    expect(handle.groupedTabs).toEqual([]);
  });
});

describe('isRestoreSessionRequest', () => {
  const valid = {
    type: RESTORE_SESSION_MESSAGE,
    specs: [],
    goToURLText: 'Go',
    closeOtherWindows: true,
    pinTabKeeper: false,
  };

  test('accepts a well-formed request', () => {
    expect(isRestoreSessionRequest(valid)).toBe(true);
  });

  test('rejects a request missing closeOtherWindows', () => {
    const withoutFlag: Record<string, unknown> = { ...valid };
    delete withoutFlag.closeOtherWindows;
    expect(isRestoreSessionRequest(withoutFlag)).toBe(false);
  });

  test('rejects a non-boolean closeOtherWindows', () => {
    expect(
      isRestoreSessionRequest({ ...valid, closeOtherWindows: 'yes' })
    ).toBe(false);
  });

  test('rejects a request without pinTabKeeper (a page from an older build)', () => {
    expect(
      isRestoreSessionRequest({
        type: RESTORE_SESSION_MESSAGE,
        specs: [],
        goToURLText: 'x',
        closeOtherWindows: false,
      })
    ).toBe(false);
  });

  test('rejects the wrong type, a non-object and null', () => {
    expect(isRestoreSessionRequest({ ...valid, type: 'something' })).toBe(
      false
    );
    expect(isRestoreSessionRequest('nope')).toBe(false);
    expect(isRestoreSessionRequest(null)).toBe(false);
  });
});

describe('restoreTargetIndex (KAN-458)', () => {
  const t = (tabId: string, pinned = false): tabData =>
    pinned
      ? { tabId, favicon: '', title: tabId, url: tabId, pinned: true }
      : { tabId, favicon: '', title: tabId, url: tabId };

  test('the saved active tab', () => {
    expect(restoreTargetIndex([t('p', true), t('a'), t('b')], 'b')).toBe(2);
  });

  test('no saved active tab: the first unpinned', () => {
    expect(restoreTargetIndex([t('p', true), t('a'), t('b')], undefined)).toBe(
      1
    );
  });

  test('a saved active tab that names no tab: the first unpinned', () => {
    expect(restoreTargetIndex([t('p', true), t('a')], 'gone')).toBe(1);
  });

  test('only pinned tabs: the first', () => {
    expect(restoreTargetIndex([t('p', true), t('q', true)], undefined)).toBe(0);
  });
});

describe('restore opens on the saved active tab, pinned tabs pinned (KAN-458)', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  const live = (id: string) => `https://${id}.test/`;
  const lazy = (id: string) =>
    generatePlaceholderURL(id, '/images/favicon.ico', live(id), 'Go');
  const page = (id: string, extra: Partial<tabData> = {}): tabData => ({
    tabId: id,
    favicon: '',
    title: id,
    url: live(id),
    ...extra,
  });
  const pin = (id: string): tabData => page(id, { pinned: true });

  const restore = (tabs: tabData[], activeTabId?: string) =>
    createWindowWithRetries(
      spec({ tabs, ...(activeTabId === undefined ? {} : { activeTabId }) }),
      'Go',
      2
    );

  async function strip(win: chrome.windows.Window | null) {
    if (win?.id === undefined) throw new Error('no window was created');
    return (await chrome.tabs.query({ windowId: win.id }))
      .sort((a, b) => a.index - b.index)
      .map((t) => ({ url: t.url, pinned: t.pinned, active: t.active }));
  }

  test('pinned tabs come back pinned and first; the saved active tab loads and is active; the rest are lazy', async () => {
    handle = setupChromeFake();
    const win = await restore(
      [pin('p1'), pin('p2'), page('a3'), page('b4')],
      'a3'
    );
    expect(await strip(win)).toEqual([
      { url: lazy('p1'), pinned: true, active: false },
      { url: lazy('p2'), pinned: true, active: false },
      { url: live('a3'), pinned: false, active: true },
      { url: lazy('b4'), pinned: false, active: false },
    ]);
  });

  test('no saved active tab: the first unpinned tab loads', async () => {
    handle = setupChromeFake();
    const win = await restore([pin('p1'), page('a2'), page('b3')]);
    expect(await strip(win)).toEqual([
      { url: lazy('p1'), pinned: true, active: false },
      { url: live('a2'), pinned: false, active: true },
      { url: lazy('b3'), pinned: false, active: false },
    ]);
  });

  test('a saved active tab that is gone: the first unpinned tab loads', async () => {
    handle = setupChromeFake();
    const win = await restore([pin('p1'), page('a2')], 'gone');
    expect((await strip(win))[1]).toEqual({
      url: live('a2'),
      pinned: false,
      active: true,
    });
  });

  test('only pinned tabs: the first loads, pinned', async () => {
    handle = setupChromeFake();
    const win = await restore([pin('p1'), pin('p2')]);
    expect(await strip(win)).toEqual([
      { url: live('p1'), pinned: true, active: true },
      { url: lazy('p2'), pinned: true, active: false },
    ]);
  });

  test('a pinned active tab loads in its place in the pinned run', async () => {
    handle = setupChromeFake();
    const win = await restore([pin('p1'), pin('p2'), page('a3')], 'p2');
    expect(await strip(win)).toEqual([
      { url: lazy('p1'), pinned: true, active: false },
      { url: live('p2'), pinned: true, active: true },
      { url: lazy('a3'), pinned: false, active: false },
    ]);
  });

  test('an old session (no fields): the first tab loads, as before', async () => {
    handle = setupChromeFake();
    const win = await restore([page('a1'), page('b2')]);
    expect(await strip(win)).toEqual([
      { url: live('a1'), pinned: false, active: true },
      { url: lazy('b2'), pinned: false, active: false },
    ]);
  });

  test('a group around the active tab is re-formed with its tabs in saved order', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });
    const win = await createWindowWithRetries(
      spec({
        tabs: [
          page('a', { chromeGroupId: 'g1' }),
          page('b', { chromeGroupId: 'g1' }),
          page('c'),
        ],
        groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
        activeTabId: 'b',
      }),
      'Go',
      2
    );
    if (win?.id === undefined) throw new Error('no window was created');
    const all = await chrome.tabs.query({ windowId: win.id });
    const idOf = (url: string) => all.find((t) => t.url === url)?.id;
    expect(handle.groupedTabs).toHaveLength(1);
    expect(handle.groupedTabs[0].tabIds).toEqual([
      idOf(lazy('a')),
      idOf(live('b')),
    ]);
  });

  test('a lazy tab Chrome refuses is skipped, and the tabs before the active one keep their order', async () => {
    handle = setupChromeFake({ refusedUrls: [lazy('x2')] });
    const win = await restore(
      [pin('p1'), page('x2'), page('y3'), page('a4')],
      'a4'
    );
    expect(await strip(win)).toEqual([
      { url: lazy('p1'), pinned: true, active: false },
      { url: lazy('y3'), pinned: false, active: false },
      { url: live('a4'), pinned: false, active: true },
    ]);
  });

  test('a saved active tab Chrome refuses: the window opens on the first unpinned tab instead', async () => {
    handle = setupChromeFake({ refusedUrls: [live('a3')] });
    const win = await restore([pin('p1'), page('x2'), page('a3')], 'a3');
    expect(await strip(win)).toEqual([
      { url: lazy('p1'), pinned: true, active: false },
      { url: live('x2'), pinned: false, active: true },
      { url: lazy('a3'), pinned: false, active: false },
    ]);
  });

  test('a refused tab that is also the fallback: the window fails, as before', async () => {
    handle = setupChromeFake({ refusedUrls: [live('a1')] });
    expect(await restore([page('a1'), page('b2')], 'a1')).toBeNull();
    expect(await chrome.windows.getAll({})).toEqual([]);
  });
});
