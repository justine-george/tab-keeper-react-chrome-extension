import { describe, expect, test } from 'vitest';

import {
  partitionTabsIntoRuns,
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
