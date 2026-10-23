import { describe, expect, test } from 'vitest';

import type { windowGroupData } from '../../redux/slices/tabContainerDataStateSlice';
import {
  isSavedWindowGroupsSortedByName,
  isSortedGroupsByName,
  sortGroupsByName,
} from '../../utils/functions/sortGroupsByName';

// KAN-746 Part 2. Only the groups move, into the slots groups held.

interface Tab {
  key: string;
  groupKey: string | null;
}

// 'x' is a loose tab x; 'G:z1' is tab z1 in group G.
const strip = (...specs: string[]): Tab[] =>
  specs.map((spec) => {
    const [group, key] = spec.includes(':') ? spec.split(':') : [null, spec];
    return { key, groupKey: group };
  });
const keys = (tabs: readonly Tab[]) => tabs.map((tab) => tab.key);
const titles =
  (byKey: Record<string, string>) =>
  (groupKey: string): string =>
    byKey[groupKey] ?? '';

describe('sortGroupsByName', () => {
  test('groups go A→Z into the slots groups held; loose tabs keep theirs', () => {
    const tabs = strip('x', 'Z:z1', 'Z:z2', 'y', 'A:a1', 'w');
    const sorted = sortGroupsByName(
      tabs,
      titles({ Z: 'Zebra', A: 'Apple' }),
      'en'
    );
    expect(keys(sorted)).toEqual(['x', 'a1', 'y', 'z1', 'z2', 'w']);
  });

  test("each group's tabs keep their own order", () => {
    const tabs = strip('B:b2', 'B:b1', 'A:a3', 'A:a1', 'A:a2');
    expect(
      keys(sortGroupsByName(tabs, titles({ A: 'a', B: 'b' }), 'en'))
    ).toEqual(['a3', 'a1', 'a2', 'b2', 'b1']);
  });

  test('numbers read as numbers, case and accents ignored', () => {
    const tabs = strip('A:t10', 'B:t2', 'C:t3', 'D:ecole');
    const sorted = sortGroupsByName(
      tabs,
      titles({ A: 'Trip 10', B: 'Trip 2', C: 'trip 3', D: 'École' }),
      'en'
    );
    expect(keys(sorted)).toEqual(['ecole', 't2', 't3', 't10']);
  });

  test('unnamed groups go last, in the order they were; a title of only spaces is unnamed', () => {
    const tabs = strip('U1:u1', 'B:b', 'U2:u2', 'A:a');
    const sorted = sortGroupsByName(
      tabs,
      titles({ U1: '', B: 'Beta', U2: '   ', A: 'Alpha' }),
      'en'
    );
    expect(keys(sorted)).toEqual(['a', 'b', 'u1', 'u2']);
  });

  test('equal names keep their current order', () => {
    const tabs = strip('W1:w1', 'C1:c1', 'W2:w2', 'C2:c2', 'W3:w3');
    const sorted = sortGroupsByName(
      tabs,
      titles({ W1: 'work', C1: 'Café', W2: 'Work', C2: 'cafe', W3: 'WORK' }),
      'en'
    );
    expect(keys(sorted)).toEqual(['c1', 'c2', 'w1', 'w2', 'w3']);
  });

  test('compares in the language given', () => {
    const tabs = strip('O:o', 'Z:z');
    const byTitle = titles({ O: 'Ört', Z: 'Zebra' });
    // Swedish puts ö after z; German sorts it with o.
    expect(keys(sortGroupsByName(tabs, byTitle, 'sv'))).toEqual(['z', 'o']);
    expect(keys(sortGroupsByName(tabs, byTitle, 'de'))).toEqual(['o', 'z']);
  });

  test('a window with no group or one group is left as it is', () => {
    const none = strip('b', 'a');
    const one = strip('b', 'G:g', 'a');
    expect(keys(sortGroupsByName(none, titles({}), 'en'))).toEqual(['b', 'a']);
    expect(keys(sortGroupsByName(one, titles({ G: 'g' }), 'en'))).toEqual([
      'b',
      'g',
      'a',
    ]);
  });

  test("a group's tabs apart in saved data are gathered at its first tab's slot", () => {
    const tabs = strip('B:b1', 'x', 'B:b2', 'A:a1');
    expect(
      keys(sortGroupsByName(tabs, titles({ A: 'a', B: 'b' }), 'en'))
    ).toEqual(['a1', 'x', 'b1', 'b2']);
  });
});

describe('isSortedGroupsByName', () => {
  test('false while two groups are out of name order, true once sorted', () => {
    const tabs = strip('x', 'B:b', 'A:a');
    const byTitle = titles({ A: 'Alpha', B: 'Beta' });
    expect(isSortedGroupsByName(tabs, byTitle, 'en')).toBe(false);
    expect(
      isSortedGroupsByName(sortGroupsByName(tabs, byTitle, 'en'), byTitle, 'en')
    ).toBe(true);
  });

  test('true with unnamed groups after named ones, whatever their order', () => {
    const tabs = strip('A:a', 'U2:u2', 'U1:u1');
    expect(isSortedGroupsByName(tabs, titles({ A: 'Alpha' }), 'en')).toBe(true);
  });
});

describe('isSavedWindowGroupsSortedByName', () => {
  const tab = (tabId: string, chromeGroupId?: string) => ({
    tabId,
    favicon: '',
    title: tabId,
    url: `https://${tabId}.test/`,
    ...(chromeGroupId ? { chromeGroupId } : {}),
  });
  const window = (
    tabs: ReturnType<typeof tab>[],
    groups: { groupId: string; title: string }[]
  ): Pick<windowGroupData, 'tabs' | 'chromeTabGroups'> => ({
    tabs,
    chromeTabGroups: groups.map((g) => ({ ...g, color: 'blue' })),
  });

  test('reads titles from chromeTabGroups', () => {
    const w = window(
      [tab('b', 'gB'), tab('a', 'gA')],
      [
        { groupId: 'gA', title: 'Alpha' },
        { groupId: 'gB', title: 'Beta' },
      ]
    );
    expect(isSavedWindowGroupsSortedByName(w, 'en')).toBe(false);
  });

  test('a group missing from chromeTabGroups counts as unnamed', () => {
    const w = window(
      [tab('u', 'gGone'), tab('a', 'gA')],
      [{ groupId: 'gA', title: 'Alpha' }]
    );
    expect(isSavedWindowGroupsSortedByName(w, 'en')).toBe(false);
    const sorted = window(
      [tab('a', 'gA'), tab('u', 'gGone')],
      [{ groupId: 'gA', title: 'Alpha' }]
    );
    expect(isSavedWindowGroupsSortedByName(sorted, 'en')).toBe(true);
  });
});
