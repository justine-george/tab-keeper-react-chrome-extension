import { describe, expect, test } from 'vitest';

import { openWindowsToSession } from '../../../utils/functions/openWindowsToSession';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import { getStringDate } from '../../../utils/functions/local';

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
      NOW
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
      title: 'A',
    });
    // No bounds reported: 0, as capture writes a missing size.
    expect(second).toMatchObject({
      windowOffsetLeft: 0,
      windowOffsetTop: 0,
      windowWidth: 0,
      windowHeight: 0,
      tabCount: 1,
      title: 'C',
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
      NOW
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
      NOW
    );

    expect('chromeTabGroups' in session.windows[0]).toBe(false);
  });

  test("cleans an unread count from the window's title and its tabs'", () => {
    const session = openWindowsToSession(
      [openWindow(1, [openTab(11, '(3) Inbox'), openTab(12, 'Docs')])],
      'Mail',
      NOW
    );

    expect(session.windows[0].title).toBe('Inbox');
    expect(session.windows[0].tabs[0].title).toBe('Inbox');
  });

  test('takes createdTime and createdAt from the one `now`', () => {
    const session = openWindowsToSession(
      [openWindow(1, [openTab(11, 'A')])],
      'Timed',
      NOW
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
      NOW
    );

    expect(session.windows[0].tabs[0].title).toBe('https://untitled.test/');
    expect(session.windows[0].title).toBe('https://untitled.test/');
  });
});
