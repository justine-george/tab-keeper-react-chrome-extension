import { describe, expect, test } from 'vitest';

import { groupLandingTab, type OpenTab } from '../../utils/functions/openNow';

// KAN-793. A live group's Go to lands on the tab of that group last used.

const tab = (id: number, extra: Partial<OpenTab> = {}): OpenTab => ({
  id,
  windowId: 2,
  title: `t${id}`,
  url: `https://h${id}.test/`,
  favIconUrl: '',
  active: false,
  pinned: false,
  audible: false,
  muted: false,
  groupId: 50,
  index: id,
  ...extra,
});

describe('groupLandingTab', () => {
  test('the window’s active tab, when it is in the group', () => {
    const tabs = [tab(22), tab(23, { active: true })];
    expect(groupLandingTab(tabs, [22])?.id).toBe(23);
  });

  test('else the newest recorded tab that is in the group', () => {
    // 21 is newer but not in the group.
    expect(groupLandingTab([tab(22), tab(23)], [21, 23, 22])?.id).toBe(23);
  });

  test('else the one Chrome last accessed', () => {
    const tabs = [
      tab(22, { lastAccessed: 500 }),
      tab(23, { lastAccessed: 900 }),
    ];
    expect(groupLandingTab(tabs, [21])?.id).toBe(23);
  });

  test('else the group’s first tab', () => {
    expect(groupLandingTab([tab(22), tab(23)], [])?.id).toBe(22);
  });

  test('worst path: a group with no tabs left has nowhere to land', () => {
    expect(groupLandingTab([], [22])).toBeUndefined();
  });
});
