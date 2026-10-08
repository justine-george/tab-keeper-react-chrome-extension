import { afterEach, describe, expect, test } from 'vitest';

import {
  openWindowsToSession,
  suggestTitleForWindow,
} from '../../../utils/functions/openWindowsToSession';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import { getStringDate } from '../../../utils/functions/local';
import { setupChromeFake } from '../../setup/chrome.fake';
import { buildChromeTab } from '../../fixtures/chromeTab';

// KAN-280 O13. Open now's snapshot as a saved session. Pure, so the windows
// are written out as the pane holds them rather than read from the fake.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function openTab(
  id: number,
  title: string,
  overrides: Partial<OpenTab> = {}
): OpenTab {
  return {
    id,
    windowId: 1,
    title,
    url: `https://${title.toLowerCase()}.test/`,
    favIconUrl: `https://${title.toLowerCase()}.test/favicon.ico`,
    active: false,
    pinned: false,
    audible: false,
    muted: false,
    groupId: null,
    index: id,
    ...overrides,
  };
}

function openWindow(
  id: number,
  tabs: OpenTab[],
  overrides: Partial<OpenWindow> = {}
): OpenWindow {
  return {
    id,
    isThisWindow: false,
    tabs,
    groups: [],
    bounds: null,
    state: 'normal',
    incognito: false,
    ...overrides,
  };
}

const NOW = new Date(2026, 8, 24, 14, 5, 9);
const NO_RECORD = () => [];

describe('openWindowsToSession (KAN-280 O13)', () => {
  test('builds the saved shape: counts, bounds, tab fields and fresh ids', () => {
    const session = openWindowsToSession(
      [
        openWindow(1, [openTab(11, 'A'), openTab(12, 'B')], {
          bounds: { left: 10, top: 20, width: 800, height: 600 },
        }),
        openWindow(2, [openTab(21, 'C')]),
      ],
      'My session',
      NOW,
      NO_RECORD
    );

    expect(session.tabGroupId).toMatch(UUID);
    expect(session.title).toBe('My session');
    expect(session.windowCount).toBe(2);
    expect(session.tabCount).toBe(3);
    expect(session.isAutoSave).toBe(false);
    expect(session.isSelected).toBe(true);

    const [first, second] = session.windows;
    expect(first.windowId).toMatch(UUID);
    expect(first.windowId).not.toBe(second.windowId);
    expect(first).toMatchObject({
      windowOffsetLeft: 10,
      windowOffsetTop: 20,
      windowWidth: 800,
      windowHeight: 600,
      tabCount: 2,
    });
    // No bounds reported: 0, as capture writes a missing size.
    expect(second).toMatchObject({
      windowOffsetLeft: 0,
      windowOffsetTop: 0,
      windowWidth: 0,
      windowHeight: 0,
      tabCount: 1,
    });

    expect(first.tabs.map((t) => t.title)).toEqual(['A', 'B']);
    expect(first.tabs[0]).toMatchObject({
      title: 'A',
      url: 'https://a.test/',
      favicon: 'https://a.test/favicon.ico',
    });
    expect(first.tabs[0].tabId).toMatch(UUID);
    expect(first.tabs[0].tabId).not.toBe(first.tabs[1].tabId);
    expect('chromeGroupId' in first.tabs[0]).toBe(false);
  });

  test("maps each Chrome group to a fresh id, and each tab follows its group's", () => {
    const session = openWindowsToSession(
      [
        openWindow(
          1,
          [
            openTab(11, 'A', { groupId: 50 }),
            openTab(12, 'B', { groupId: 50 }),
            openTab(13, 'C', { groupId: 60 }),
            openTab(14, 'D'),
          ],
          {
            groups: [
              { id: 50, title: 'Research', color: 'blue', collapsed: false },
              { id: 60, title: '', color: 'red', collapsed: true },
            ],
          }
        ),
      ],
      'Grouped',
      NOW,
      NO_RECORD
    );

    const [saved] = session.windows;
    const groups = saved.chromeTabGroups ?? [];
    expect(groups.map(({ title, color }) => ({ title, color }))).toEqual([
      { title: 'Research', color: 'blue' },
      { title: '', color: 'red' },
    ]);
    // Fresh ids, never Chrome's numbers: those are only good for this browser
    // session, and a restore would match them against nothing.
    for (const group of groups) expect(group.groupId).toMatch(UUID);
    expect(groups[0].groupId).not.toBe(groups[1].groupId);
    expect(saved.tabs.map((t) => t.chromeGroupId)).toEqual([
      groups[0].groupId,
      groups[0].groupId,
      groups[1].groupId,
      undefined,
    ]);
    expect('chromeGroupId' in saved.tabs[3]).toBe(false);
  });

  test('writes no chromeTabGroups key for a window without groups', () => {
    const session = openWindowsToSession(
      [openWindow(1, [openTab(11, 'A')])],
      'Plain',
      NOW,
      NO_RECORD
    );

    expect('chromeTabGroups' in session.windows[0]).toBe(false);
  });

  test("cleans an unread count from its tabs' titles", () => {
    const session = openWindowsToSession(
      [openWindow(1, [openTab(11, '(3) Inbox'), openTab(12, 'Docs')])],
      'Mail',
      NOW,
      NO_RECORD
    );

    expect(session.windows[0].tabs[0].title).toBe('Inbox');
  });

  // KAN-394 L4: saved unnamed, for the list to draw as "Window N".
  test('saves each window unnamed', () => {
    const session = openWindowsToSession(
      [
        openWindow(1, [openTab(11, 'A'), openTab(12, 'B')]),
        openWindow(2, [openTab(21, 'C')]),
      ],
      'Two',
      NOW,
      NO_RECORD
    );

    // PREMISE: each window's first tab has a title it could have been named by.
    expect(session.windows.map((w) => w.tabs[0].title)).toEqual(['A', 'C']);
    expect(session.windows.map((w) => w.title)).toEqual(['', '']);
  });

  test('takes createdTime and createdAt from the one `now`', () => {
    const session = openWindowsToSession(
      [openWindow(1, [openTab(11, 'A')])],
      'Timed',
      NOW,
      NO_RECORD
    );

    expect(session.createdTime).toBe(getStringDate(NOW));
    expect(session.createdTime).toBe('2026-09-24 14:05:09');
    expect(session.createdAt).toBe(NOW.getTime());
  });

  test('an untitled tab is saved under its address', () => {
    // OpenTab.title already falls back to the address (toOpenTab).
    const untitled = openTab(11, 'x', {
      title: 'https://untitled.test/',
      url: 'https://untitled.test/',
    });
    const session = openWindowsToSession(
      [openWindow(1, [untitled])],
      'Untitled',
      NOW,
      NO_RECORD
    );

    expect(session.windows[0].tabs[0].title).toBe('https://untitled.test/');
  });
});

describe('suggestTitleForWindow skips the store and the New Tab page (§8)', () => {
  const STORE = {
    url: 'https://chromewebstore.google.com/detail/tab-keeper/abc',
    title: 'Tab Keeper - Chrome Web Store',
  };
  const GMAIL = {
    url: 'https://mail.google.com/mail/u/0/',
    title: 'Inbox – Gmail',
  };
  const NEW_TAB = { url: 'chrome://newtab/', title: 'New Tab' };

  let handle: ReturnType<typeof setupChromeFake> | undefined;
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  const nameOf = async (
    tabs: { url: string; title: string; lastAccessed: number }[]
  ) => {
    const seeded = tabs.map((tab, i) =>
      buildChromeTab({ id: i + 1, windowId: 7, ...tab })
    );
    handle = setupChromeFake({
      tabs: seeded,
      windows: [{ id: 7, tabs: seeded }],
    });
    return suggestTitleForWindow(7, 'New Tab Group');
  };

  test('the store most recent, Gmail behind it: the Gmail title', async () => {
    expect(
      await nameOf([
        { ...GMAIL, lastAccessed: 2 },
        { ...STORE, lastAccessed: 3 },
      ])
    ).toBe('Inbox – Gmail');
  });

  test.each([
    ['the store', STORE],
    ['a New Tab', NEW_TAB],
  ])('only %s: the fallback', async (_name, only) => {
    expect(await nameOf([{ ...only, lastAccessed: 3 }])).toBe('New Tab Group');
  });
});

describe('openWindowsToSession keeps pins and the active tab (KAN-458)', () => {
  test('a pinned tab is saved pinned, and the active tab is the activeTabId', () => {
    const [w] = openWindowsToSession(
      [
        openWindow(1, [
          openTab(11, 'A', { pinned: true }),
          openTab(12, 'B', { active: true }),
          openTab(13, 'C'),
        ]),
      ],
      'S',
      NOW,
      NO_RECORD
    ).windows;

    expect(w.tabs.map((t) => t.pinned)).toEqual([true, undefined, undefined]);
    expect(w.activeTabId).toBe(w.tabs[1].tabId);
  });

  test('no listed tab is active (Tab Keeper was): the most recently used (A4)', () => {
    const [w] = openWindowsToSession(
      [
        openWindow(1, [
          openTab(11, 'A', { lastAccessed: 200 }),
          openTab(12, 'B', { lastAccessed: 500 }),
        ]),
      ],
      'S',
      NOW,
      NO_RECORD
    ).windows;

    expect(w.activeTabId).toBe(w.tabs[1].tabId);
  });

  test("no listed tab is active: the window's latest recorded tab wins over a later lastAccessed (A4)", () => {
    // 99 is the Tab Keeper page the user was on, never listed; 12 the tab before it.
    const recentTabsOf = (windowId: number | undefined) =>
      windowId === 1 ? [99, 12, 11] : [];
    const [w] = openWindowsToSession(
      [
        openWindow(1, [
          openTab(11, 'A', { lastAccessed: 200 }),
          openTab(12, 'B', { lastAccessed: 100 }),
          openTab(13, 'C', { lastAccessed: 500 }),
        ]),
      ],
      'S',
      NOW,
      recentTabsOf
    ).windows;

    expect(w.activeTabId).toBe(w.tabs[1].tabId);
  });

  test('nothing active and nothing stamped: no activeTabId', () => {
    const [w] = openWindowsToSession(
      [openWindow(1, [openTab(11, 'A'), openTab(12, 'B')])],
      'S',
      NOW,
      NO_RECORD
    ).windows;

    expect('activeTabId' in w).toBe(false);
  });
});
