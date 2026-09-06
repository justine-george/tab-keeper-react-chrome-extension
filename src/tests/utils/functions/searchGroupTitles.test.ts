import { describe, expect, test } from 'vitest';

import {
  filterTabGroups,
  selectVisibleTabGroups,
} from '../../../utils/functions/local';
import { buildSession } from '../../fixtures/sessionFixture';
import type { tabContainerData } from '../../../redux/slices/tabContainerDataStateSlice';

// KAN-104. One window holding two named Chrome groups, an ungrouped tab, and a
// tab whose chromeGroupId names a group that is not there -- the shape an
// import or a merge can produce, and the one partitionTabsIntoRuns already has
// to survive.
//
// No session title, window title, tab title or URL contains "Quarterly", so a
// query for it can only be answered by reading the group's title. That is what
// makes these tests fail against the three-level filter rather than pass by
// coincidence of some other level matching.
const grouped = (): tabContainerData =>
  buildSession({
    tabGroupId: 'session-grouped',
    title: 'Alpha',
    windowCount: 1,
    tabCount: 5,
    windows: [
      {
        windowId: 'window-1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 5,
        title: 'Beta window',
        chromeTabGroups: [
          { groupId: 'g-1', title: 'Quarterly', color: 'blue' },
          { groupId: 'g-2', title: 'Personal', color: 'green' },
        ],
        tabs: [
          {
            tabId: 'tab-1',
            favicon: '',
            title: 'Gamma',
            url: 'https://example.com/gamma',
            chromeGroupId: 'g-1',
          },
          {
            tabId: 'tab-2',
            favicon: '',
            title: 'Delta',
            url: 'https://example.com/delta',
          },
          {
            tabId: 'tab-3',
            favicon: '',
            title: 'Epsilon',
            url: 'https://example.com/epsilon',
            chromeGroupId: 'g-1',
          },
          {
            tabId: 'tab-4',
            favicon: '',
            title: 'Zeta',
            url: 'https://example.com/zeta',
            chromeGroupId: 'g-2',
          },
          {
            tabId: 'tab-5',
            favicon: '',
            title: 'Orphaned',
            url: 'https://example.com/orphaned',
            chromeGroupId: 'g-vanished',
          },
        ],
      },
    ],
  });

const titlesOf = (groups: tabContainerData[]): string[] =>
  groups.flatMap((group) =>
    group.windows.flatMap((window) => window.tabs.map((tab) => tab.title))
  );

describe('filterTabGroups matching a Chrome group title', () => {
  test('finds a session whose only match is a group title', () => {
    expect(filterTabGroups('Quarterly', [grouped()], true)).toHaveLength(1);
  });

  test('admits the group members and nothing else in the window', () => {
    const matched = filterTabGroups('Quarterly', [grouped()], true);

    expect(titlesOf(matched)).toEqual(['Gamma', 'Epsilon']);
  });

  test('narrows the counts to what matched', () => {
    const [matched] = filterTabGroups('Quarterly', [grouped()], true);

    expect(matched.windowCount).toBe(1);
    expect(matched.tabCount).toBe(2);
  });

  test('keeps the group definitions so the band still renders', () => {
    const [matched] = filterTabGroups('Quarterly', [grouped()], true);

    expect(matched.windows[0].chromeTabGroups).toEqual([
      { groupId: 'g-1', title: 'Quarterly', color: 'blue' },
      { groupId: 'g-2', title: 'Personal', color: 'green' },
    ]);
  });

  test('is case insensitive, like every other level', () => {
    expect(titlesOf(filterTabGroups('quarterly', [grouped()], true))).toEqual([
      'Gamma',
      'Epsilon',
    ]);
  });

  test('matches on a substring, like every other level', () => {
    expect(titlesOf(filterTabGroups('quart', [grouped()], true))).toEqual([
      'Gamma',
      'Epsilon',
    ]);
  });

  test('admits each group separately', () => {
    expect(titlesOf(filterTabGroups('Personal', [grouped()], true))).toEqual([
      'Zeta',
    ]);
  });

  test('keeps a tab that matches on its own alongside the group members', () => {
    const session = grouped();
    session.windows[0].tabs[1] = {
      tabId: 'tab-2',
      favicon: '',
      title: 'Quarterly review doc',
      url: 'https://example.com/delta',
    };

    // In stored order: the ungrouped match sits between the two group members.
    expect(titlesOf(filterTabGroups('Quarterly', [session], true))).toEqual([
      'Gamma',
      'Quarterly review doc',
      'Epsilon',
    ]);
  });
});

describe('filterTabGroups without the tabGroups permission', () => {
  // The right pane only draws group bands when the permission is granted
  // (WindowEntryContainer), so without it a group title is invisible
  // everywhere in the UI. Matching one would narrow a window to a subset of
  // its tabs with nothing on screen saying why.
  test('does not match a group title', () => {
    expect(filterTabGroups('Quarterly', [grouped()], false)).toEqual([]);
  });

  test('still matches the levels that are visible', () => {
    expect(filterTabGroups('Alpha', [grouped()], false)).toHaveLength(1);
    expect(filterTabGroups('Beta window', [grouped()], false)).toHaveLength(1);
    expect(titlesOf(filterTabGroups('Gamma', [grouped()], false))).toEqual([
      'Gamma',
    ]);
  });
});

describe('filterTabGroups group matching, off the happy path', () => {
  test('a tab pointing at a group that is not there is not admitted', () => {
    // 'g-vanished' has no definition, so nothing can match its title. The tab
    // is reachable only by its own title.
    expect(filterTabGroups('vanished', [grouped()], true)).toEqual([]);
    expect(titlesOf(filterTabGroups('Orphaned', [grouped()], true))).toEqual([
      'Orphaned',
    ]);
  });

  test('an unnamed group never matches a query', () => {
    // Chrome allows a group with no name; its stored title is ''. Every
    // non-empty query must miss it -- ''.includes(q) is false -- rather than
    // it swallowing the window.
    const session = grouped();
    session.windows[0].chromeTabGroups = [
      { groupId: 'g-1', title: '', color: 'blue' },
      { groupId: 'g-2', title: '', color: 'green' },
    ];

    expect(filterTabGroups('Quarterly', [session], true)).toEqual([]);
  });

  test('a window with no groups at all is unaffected', () => {
    const session = grouped();
    delete session.windows[0].chromeTabGroups;

    expect(filterTabGroups('Quarterly', [session], true)).toEqual([]);
    expect(titlesOf(filterTabGroups('Delta', [session], true))).toEqual([
      'Delta',
    ]);
  });

  test('an empty group list is unaffected', () => {
    const session = grouped();
    session.windows[0].chromeTabGroups = [];

    expect(filterTabGroups('Quarterly', [session], true)).toEqual([]);
  });

  test('a group whose members have all gone contributes no window', () => {
    // The group definition outlives its tabs after a delete. It must not
    // resurrect the window as an empty match.
    const session = grouped();
    session.windows[0].chromeTabGroups = [
      { groupId: 'g-orphan', title: 'Quarterly', color: 'blue' },
    ];

    expect(filterTabGroups('Quarterly', [session], true)).toEqual([]);
  });

  test('a session title match still wins outright over group narrowing', () => {
    // 'Alpha' is the session title, so the whole session is admitted whole --
    // group matching must not narrow a level that already matched above it.
    const matched = filterTabGroups('Alpha', [grouped()], true);

    expect(titlesOf(matched)).toEqual([
      'Gamma',
      'Delta',
      'Epsilon',
      'Zeta',
      'Orphaned',
    ]);
  });

  test('a window title match still wins outright over group narrowing', () => {
    const matched = filterTabGroups('Beta window', [grouped()], true);

    expect(titlesOf(matched)).toEqual([
      'Gamma',
      'Delta',
      'Epsilon',
      'Zeta',
      'Orphaned',
    ]);
  });
});

describe('selectVisibleTabGroups carries the permission through', () => {
  const selected = () => ({ ...grouped(), isSelected: true });

  test('matches a group title when the permission is granted', () => {
    const visible = selectVisibleTabGroups(
      [selected()],
      true,
      'Quarterly',
      true
    );

    expect(titlesOf(visible)).toEqual(['Gamma', 'Epsilon']);
  });

  test('does not when it is not', () => {
    expect(
      selectVisibleTabGroups([selected()], true, 'Quarterly', false)
    ).toEqual([]);
  });

  test('the permission changes nothing while no search is running', () => {
    expect(selectVisibleTabGroups([selected()], false, '', false)).toHaveLength(
      1
    );
    expect(selectVisibleTabGroups([selected()], false, '', true)).toHaveLength(
      1
    );
  });
});
