import { describe, expect, test } from 'vitest';

import {
  partitionTabsIntoRuns,
  partitionTabsIntoItems,
  itemIdOf,
  groupIdOfItemId,
  sanitizeTabGroupColor,
  TAB_GROUP_COLORS,
  TAB_GROUP_COLOR_HEX,
} from '../../../utils/functions/tabGroups';
import type { chromeTabGroupData } from '../../../utils/functions/tabGroups';
import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';

function tab(tabId: string, chromeGroupId?: string): tabData {
  return {
    tabId,
    favicon: '',
    title: `title ${tabId}`,
    url: `https://example.com/${tabId}`,
    ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
  };
}

function group(
  groupId: string,
  title = 'Work',
  color = 'blue'
): chromeTabGroupData {
  return { groupId, title, color };
}

describe('sanitizeTabGroupColor', () => {
  test('passes through every colour Chrome defines', () => {
    for (const color of TAB_GROUP_COLORS) {
      expect(sanitizeTabGroupColor(color)).toBe(color);
    }
  });

  // The resilience case. A newer client, or a future Chrome, may write a
  // colour this build has never heard of. It must degrade to one group
  // rendering grey, never to a rejected document.
  test('falls back to grey for an unknown colour', () => {
    expect(sanitizeTabGroupColor('chartreuse')).toBe('grey');
    expect(sanitizeTabGroupColor('')).toBe('grey');
  });

  test('every colour has a hex value', () => {
    for (const color of TAB_GROUP_COLORS) {
      expect(TAB_GROUP_COLOR_HEX[color]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('partitionTabsIntoRuns', () => {
  test('no groups yields one ungrouped run holding every tab in order', () => {
    const tabs = [tab('a'), tab('b'), tab('c')];
    expect(partitionTabsIntoRuns(tabs, undefined)).toEqual([
      { kind: 'ungrouped', tabs },
    ]);
  });

  test('an empty group list is the same as no groups', () => {
    const tabs = [tab('a')];
    expect(partitionTabsIntoRuns(tabs, [])).toEqual([
      { kind: 'ungrouped', tabs },
    ]);
  });

  test('splits leading, grouped and trailing runs in order', () => {
    const g = group('g1', 'Work', 'blue');
    const tabs = [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d')];

    expect(partitionTabsIntoRuns(tabs, [g])).toEqual([
      { kind: 'ungrouped', tabs: [tabs[0]] },
      { kind: 'group', group: g, tabs: [tabs[1], tabs[2]] },
      { kind: 'ungrouped', tabs: [tabs[3]] },
    ]);
  });

  test('two adjacent groups stay separate runs', () => {
    const g1 = group('g1', 'Work', 'blue');
    const g2 = group('g2', 'Reading', 'green');
    const tabs = [tab('a', 'g1'), tab('b', 'g2')];

    expect(partitionTabsIntoRuns(tabs, [g1, g2])).toEqual([
      { kind: 'group', group: g1, tabs: [tabs[0]] },
      { kind: 'group', group: g2, tabs: [tabs[1]] },
    ]);
  });

  // Data can only reach this state through an import or a merge; Chrome
  // itself cannot produce a non-contiguous group. Coalescing keeps the pane
  // agreeing with the restore, which calls tabs.group and makes them
  // contiguous anyway.
  test('coalesces a non-contiguous group at its first appearance', () => {
    const g1 = group('g1', 'Work', 'blue');
    const tabs = [tab('a', 'g1'), tab('b'), tab('c', 'g1')];

    expect(partitionTabsIntoRuns(tabs, [g1])).toEqual([
      { kind: 'group', group: g1, tabs: [tabs[0], tabs[2]] },
      { kind: 'ungrouped', tabs: [tabs[1]] },
    ]);
  });

  test('a chromeGroupId with no matching group renders ungrouped', () => {
    const tabs = [tab('a', 'missing'), tab('b')];

    expect(partitionTabsIntoRuns(tabs, [group('g1')])).toEqual([
      { kind: 'ungrouped', tabs: [tabs[0], tabs[1]] },
    ]);
  });

  test('a group with no surviving tabs is omitted', () => {
    const tabs = [tab('a')];

    expect(partitionTabsIntoRuns(tabs, [group('orphan')])).toEqual([
      { kind: 'ungrouped', tabs },
    ]);
  });

  test('an empty tab list yields no runs at all', () => {
    expect(partitionTabsIntoRuns([], [group('g1')])).toEqual([]);
  });
});

// KAN-160. The rows a window draws at the top level: every loose tab on its
// own, every group as ONE item. The group drag indexes this list, and so does
// moveChromeGroupInternal -- which is only sound because both build it with
// this one function (KAN-131: an index is only valid in the list that
// produced it).
describe('partitionTabsIntoItems', () => {
  const groups: chromeTabGroupData[] = [
    { groupId: 'alpha', title: 'Alpha', color: 'blue' },
    { groupId: 'beta', title: 'Beta', color: 'red' },
  ];

  test('expands loose runs to one item per tab and keeps each group whole', () => {
    const items = partitionTabsIntoItems(
      [
        tab('a0'),
        tab('g1a', 'alpha'),
        tab('g1b', 'alpha'),
        tab('a1'),
        tab('a2'),
        tab('g2a', 'beta'),
      ],
      groups
    );
    expect(items.map(itemIdOf)).toEqual([
      'tab:a0',
      'group:alpha',
      'tab:a1',
      'tab:a2',
      'group:beta',
    ]);
    const alpha = items[1];
    expect(alpha.kind === 'group' && alpha.tabs.map((x) => x.tabId)).toEqual([
      'g1a',
      'g1b',
    ]);
  });

  // The screen draws a non-contiguous group as one band at its first member,
  // so the item list must too.
  test('a non-contiguous group is one item, at its first member', () => {
    const items = partitionTabsIntoItems(
      [tab('a0'), tab('g1a', 'alpha'), tab('a1'), tab('g1b', 'alpha')],
      groups
    );
    expect(items.map(itemIdOf)).toEqual(['tab:a0', 'group:alpha', 'tab:a1']);
  });

  // Without the permission the pane passes no groups, and a tab pointing at a
  // group that is not listed is the user's data, not a dangling reference.
  test('with no groups, or an unknown group id, every tab is its own item', () => {
    expect(
      partitionTabsIntoItems([tab('a0'), tab('g1a', 'alpha')], undefined).map(
        itemIdOf
      )
    ).toEqual(['tab:a0', 'tab:g1a']);
    expect(
      partitionTabsIntoItems([tab('x', 'nope')], groups).map(itemIdOf)
    ).toEqual(['tab:x']);
  });

  test('an empty window has no items', () => {
    expect(partitionTabsIntoItems([], groups)).toEqual([]);
  });
});

describe('groupIdOfItemId', () => {
  test('reads the group id back out of a group item id', () => {
    expect(groupIdOfItemId('group:alpha')).toBe('alpha');
  });

  // A loose tab is not a group. Answering with a string here would let a tab
  // id reach the group reducer.
  test('a tab item id is not a group', () => {
    expect(groupIdOfItemId('tab:a0')).toBeUndefined();
  });

  test('neither prefix is not a group', () => {
    expect(groupIdOfItemId('alpha')).toBeUndefined();
  });
});
