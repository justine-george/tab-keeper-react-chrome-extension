import { afterEach, describe, expect, test, vi } from 'vitest';

// Mocked so the "with groups" colour test can PROVE toOpenWindows delegates
// to sanitizeTabGroupColor, rather than merely observing a value that would
// look identical whether it was sanitised or passed through raw. Chrome's own
// `chrome.tabGroups.TabGroup.color` type enumerates exactly nine colours, so
// there is no way to hand toOpenWindows a genuinely out-of-domain colour
// through that typed parameter without a cast -- and Global Constraints bans
// casts here. A spy on the real function is the honest substitute: it proves
// the call happens (and with what argument) without needing to fake data the
// type system will not allow.
vi.mock('../../../utils/functions/tabGroups', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../utils/functions/tabGroups')>();
  return {
    ...actual,
    sanitizeTabGroupColor: vi.fn(actual.sanitizeTabGroupColor),
  };
});

import {
  toOpenWindows,
  switchToOpenTab,
} from '../../../utils/functions/openNow';
import type { OpenTab } from '../../../utils/functions/openNow';
import { sanitizeTabGroupColor } from '../../../utils/functions/tabGroups';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.mocked(sanitizeTabGroupColor).mockClear();
});

// The extension's own page, exactly as isTabKeeperPage checks it. Needs a
// fake installed to read chrome.runtime.getURL from, but a test's own fake is
// built from a seed that embeds this url -- so this installs and tears down a
// throwaway fake just to read the url scheme, ahead of the real one.
function tabKeeperUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

// Real Window[] from the fake, queried the way Global Constraints specifies,
// rather than hand-built literals -- so every field chrome actually promises
// (and none it doesn't) is present, with no cast needed to satisfy the type.
function getWindows(): Promise<chrome.windows.Window[]> {
  return chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
}

function getGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  return chrome.tabGroups.query({});
}

describe('toOpenWindows', () => {
  test('maps windows in getAll order, tagging isThisWindow by id', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: 'https://a.test/' }] },
        { id: 2, tabs: [{ url: 'https://b.test/' }] },
      ],
    });

    const windows = await getWindows();
    const result = toOpenWindows(windows, null, 2);

    expect(result.map((w) => w.id)).toEqual([1, 2]);
    expect(result[0].isThisWindow).toBe(false);
    expect(result[1].isThisWindow).toBe(true);
  });

  test('excludes a tab whose url is the Tab Keeper page, and one whose pendingUrl is when url is empty', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://a.test/' },
            { url: tabKeeperUrl() },
            { url: '', pendingUrl: tabKeeperUrl() },
          ],
        },
      ],
    });

    const windows = await getWindows();
    const result = toOpenWindows(windows, null, null);

    expect(result).toHaveLength(1);
    expect(result[0].tabs).toHaveLength(1);
    expect(result[0].tabs[0].url).toBe('https://a.test/');
  });

  test('drops a window entirely when its only tab is a Tab Keeper page (Review Focus 2)', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: tabKeeperUrl() }] },
        { id: 2, tabs: [{ url: 'https://b.test/' }] },
      ],
    });

    const windows = await getWindows();
    const result = toOpenWindows(windows, null, null);

    expect(result.map((w) => w.id)).toEqual([2]);
  });

  test('skips a tab with no id, without throwing or producing NaN', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: undefined, url: 'https://no-id.test/' },
            { url: 'https://a.test/' },
          ],
        },
      ],
    });

    const windows = await getWindows();

    expect(() => toOpenWindows(windows, null, null)).not.toThrow();
    const result = toOpenWindows(windows, null, null);

    expect(result).toHaveLength(1);
    expect(result[0].tabs).toHaveLength(1);
    expect(result[0].tabs[0].url).toBe('https://a.test/');
    expect(Number.isNaN(result[0].tabs[0].id)).toBe(false);
  });

  test('skips a window with no id entirely, without throwing', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: 'https://a.test/' }] },
        { id: undefined, tabs: [{ url: 'https://b.test/' }] },
      ],
    });

    const windows = await getWindows();

    expect(() => toOpenWindows(windows, null, null)).not.toThrow();
    const result = toOpenWindows(windows, null, null);

    expect(result.map((w) => w.id)).toEqual([1]);
  });

  test('title falls back to the url for a loading tab, favIconUrl is "" when absent, muted reads mutedInfo.muted', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            {
              title: '',
              url: 'https://loading.test/',
              mutedInfo: { muted: true },
            },
          ],
        },
      ],
    });

    const windows = await getWindows();
    const result = toOpenWindows(windows, null, null);

    expect(result[0].tabs[0]).toMatchObject({
      title: 'https://loading.test/',
      favIconUrl: '',
      muted: true,
    });
  });

  test('groups === null: every groupId is null and groups is [], even for a tab carrying a Chrome group id', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/', groupId: 7 }] }],
      tabGroups: [{ id: 7, title: 'Work', color: 'blue', windowId: 1 }],
    });

    const windows = await getWindows();
    const result = toOpenWindows(windows, null, null);

    expect(result[0].tabs[0].groupId).toBeNull();
    expect(result[0].groups).toEqual([]);
  });

  test('with groups: a tab in group 7 gets groupId 7, and the window lists the group once with its colour and collapsed state', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://a.test/', groupId: 7 },
            { url: 'https://b.test/', groupId: 7 },
          ],
        },
      ],
      tabGroups: [
        { id: 7, title: 'Work', color: 'blue', collapsed: true, windowId: 1 },
      ],
    });

    const windows = await getWindows();
    const groups = await getGroups();
    const result = toOpenWindows(windows, groups, null);

    expect(result[0].tabs.map((t) => t.groupId)).toEqual([7, 7]);
    expect(result[0].groups).toEqual([
      { id: 7, title: 'Work', color: 'blue', collapsed: true },
    ]);
  });

  test('lists groups in FIRST-TAB order, not by group id', async () => {
    // Group B's id (20) is HIGHER than group A's (10), but B's first tab
    // comes before A's -- so a sort-by-id, or a reverse of encounter order,
    // both disagree with this and must fail it.
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://ungrouped.test/' },
            { url: 'https://b1.test/', groupId: 20 },
            { url: 'https://b2.test/', groupId: 20 },
            { url: 'https://a1.test/', groupId: 10 },
          ],
        },
      ],
      tabGroups: [
        { id: 20, title: 'B', color: 'blue', windowId: 1 },
        { id: 10, title: 'A', color: 'green', windowId: 1 },
      ],
    });

    const windows = await getWindows();
    const groups = await getGroups();
    const result = toOpenWindows(windows, groups, null);

    expect(result[0].groups.map((g) => g.id)).toEqual([20, 10]);
  });

  test('the group colour is produced by sanitizeTabGroupColor, not a raw pass-through', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/', groupId: 7 }] }],
      tabGroups: [{ id: 7, title: 'Work', color: 'blue', windowId: 1 }],
    });

    const windows = await getWindows();
    const groups = await getGroups();

    toOpenWindows(windows, groups, null);

    expect(vi.mocked(sanitizeTabGroupColor)).toHaveBeenCalledWith('blue');
  });

  test('a group whose tabs are all Tab Keeper pages is not listed', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: tabKeeperUrl(), groupId: 7 },
            { url: 'https://a.test/' },
          ],
        },
      ],
      tabGroups: [{ id: 7, title: 'Work', color: 'blue', windowId: 1 }],
    });

    const windows = await getWindows();
    const groups = await getGroups();
    const result = toOpenWindows(windows, groups, null);

    expect(result[0].groups).toEqual([]);
  });

  test('a group from another window is not listed', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: 'https://a.test/' }] },
        { id: 2, tabs: [{ url: 'https://b.test/', groupId: 8 }] },
      ],
      tabGroups: [{ id: 8, title: 'Elsewhere', color: 'green', windowId: 2 }],
    });

    const windows = await getWindows();
    const groups = await getGroups();
    const result = toOpenWindows(windows, groups, null);

    const win1 = result.find((w) => w.id === 1);
    const win2 = result.find((w) => w.id === 2);
    expect(win1?.groups).toEqual([]);
    expect(win2?.groups.map((g) => g.id)).toEqual([8]);
  });

  test('a tab whose groupId names no known group gets null', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/', groupId: 999 }] }],
    });

    const windows = await getWindows();
    const groups = await getGroups();
    const result = toOpenWindows(windows, groups, null);

    expect(result[0].tabs[0].groupId).toBeNull();
    expect(result[0].groups).toEqual([]);
  });
});

describe('what a recreate needs (KAN-280 O8)', () => {
  test('each window carries its bounds, state and incognito flag', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          left: 10,
          top: 20,
          width: 800,
          height: 600,
          state: 'maximized',
          incognito: false,
          tabs: [{ url: 'https://a.test/' }],
        },
        {
          id: 2,
          state: 'minimized',
          incognito: true,
          tabs: [{ url: 'https://b.test/' }],
        },
      ],
    });
    const all = await getWindows();
    const [first, second] = toOpenWindows(all, null, null);
    expect([first.bounds, first.state, first.incognito]).toEqual([
      { left: 10, top: 20, width: 800, height: 600 },
      'maximized',
      false,
    ]);
    expect([second.bounds, second.state, second.incognito]).toEqual([
      null,
      'minimized',
      true,
    ]);
  });

  test("a tab's index is Chrome's, counting the Tab Keeper pages the pane leaves out", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://a.test/' },
            { url: tabKeeperUrl() },
            { url: 'https://b.test/' },
          ],
        },
      ],
    });
    const all = await getWindows();
    const [win] = toOpenWindows(all, null, null);
    expect(win.tabs.map((t) => [t.url, t.index])).toEqual([
      ['https://a.test/', 0],
      ['https://b.test/', 2],
    ]);
  });

  test('state is normal when Chrome omits it', async () => {
    // The fake's seeded window carries no `state` unless the seed names one.
    handle = setupChromeFake({
      windows: [{ id: 3, tabs: [{ url: 'https://c.test/' }] }],
    });
    const all = await getWindows();
    expect(all[0].state).toBeUndefined(); // the premise
    const [win] = toOpenWindows(all, null, null);
    expect(win.state).toBe('normal');
  });
});

describe('switchToOpenTab', () => {
  test('activates the tab and focuses its window', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ url: 'https://a.test/' }] },
        { id: 2, focused: false, tabs: [{ url: 'https://b.test/' }] },
      ],
    });
    const all = await chrome.windows.getAll({ populate: true });
    const targetWindow = all.find((w) => w.id === 2);
    const targetTabId = targetWindow?.tabs?.[0]?.id;
    if (typeof targetTabId !== 'number') {
      throw new Error('seeded tab has no id');
    }

    const openTab: OpenTab = {
      id: targetTabId,
      windowId: 2,
      title: 'B',
      url: 'https://b.test/',
      favIconUrl: '',
      active: false,
      pinned: false,
      audible: false,
      muted: false,
      groupId: null,
      index: 0,
    };

    await switchToOpenTab(openTab);

    const tab = await new Promise<chrome.tabs.Tab>((resolve) =>
      chrome.tabs.get(targetTabId, resolve)
    );
    expect(tab.active).toBe(true);

    const afterAll = await chrome.windows.getAll({});
    const focused = afterAll.find((w) => w.id === 2);
    expect(focused?.focused).toBe(true);
  });
});
