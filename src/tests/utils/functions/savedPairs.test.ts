import { describe, expect, test } from 'vitest';

import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import {
  isSavedPair,
  itemIndexOfRow,
  itemSlotOutsidePairs,
  savedFollowerIds,
  savedRowWindows,
  slotOutsidePairs,
  tabIndexOfRow,
  withoutSavedFollowers,
} from '../../../utils/functions/savedPairs';
import { partitionTabsIntoItems } from '../../../utils/functions/tabGroups';

const tab = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://example.com/${tabId}`,
  ...extra,
});

const half = (tabId: string, splitId = 's', extra: Partial<tabData> = {}) =>
  tab(tabId, { splitId, ...extra });

const none: ReadonlySet<string> = new Set();
// a, then a pair, then b.
const window4 = [tab('a'), half('h1'), half('h2'), tab('b')];
// A plain tab between two halves: Chrome would refuse them, so no pair.
const broken = [half('x1'), tab('h'), half('x2')];

describe('the rows a saved window draws (KAN-942)', () => {
  test('a pair has one follower, its second half', () => {
    expect([...savedFollowerIds(window4)]).toEqual(['h2']);
    expect(withoutSavedFollowers(window4).map((t) => t.tabId)).toEqual([
      'a',
      'h1',
      'b',
    ]);
  });

  test('a pair differing in pin has no follower', () => {
    const tabs = [half('p', 's', { pinned: true }), half('q')];
    expect(savedFollowerIds(tabs).size).toBe(0);
  });

  test('a pair differing in group has no follower', () => {
    const tabs = [half('p', 's', { chromeGroupId: 'g' }), half('q')];
    expect(savedFollowerIds(tabs).size).toBe(0);
  });

  test('a broken pair has no follower', () => {
    expect(savedFollowerIds(broken).size).toBe(0);
  });

  test('savedRowWindows keeps the same objects with no pair', () => {
    const plain = { tabs: [tab('a')] };
    const windows = [plain];
    expect(savedRowWindows(windows)).toBe(windows);
  });

  test('savedRowWindows keeps a window with no pair beside one with a pair', () => {
    const plain = { tabs: [tab('a')] };
    const rows = savedRowWindows([plain, { tabs: window4 }]);
    expect(rows[0]).toBe(plain);
    expect(rows[1].tabs.map((t) => t.tabId)).toEqual(['a', 'h1', 'b']);
  });
});

describe('isSavedPair (KAN-942)', () => {
  test('true for a pair, head first', () => {
    expect(isSavedPair(window4, 'h1', 'h2')).toBe(true);
  });

  test('false for swapped ids', () => {
    expect(isSavedPair(window4, 'h2', 'h1')).toBe(false);
  });

  test('false for a broken pair', () => {
    expect(isSavedPair(broken, 'x1', 'x2')).toBe(false);
  });

  test('false with a half gone', () => {
    expect(isSavedPair([half('h1')], 'h1', 'h2')).toBe(false);
  });
});

describe('tabIndexOfRow (KAN-942)', () => {
  test('row 2 starts after the pair', () => {
    expect(tabIndexOfRow(window4, none, 2)).toBe(3);
  });

  test('past the last row is the list end', () => {
    expect(tabIndexOfRow(window4, none, 3)).toBe(4);
  });

  test('a held pair counts in neither space', () => {
    expect(tabIndexOfRow(window4, new Set(['h1', 'h2']), 1)).toBe(1);
  });

  test('two pairs side by side count as two rows', () => {
    const tabs = [
      half('p1', 'p'),
      half('p2', 'p'),
      half('q1', 'q'),
      half('q2', 'q'),
    ];
    expect(tabIndexOfRow(tabs, none, 1)).toBe(2);
  });

  test('a broken pair stays two rows while the tab between them is held', () => {
    expect(tabIndexOfRow(broken, new Set(['h']), 1)).toBe(1);
  });

  test('a held plain tab above a pair: the row past the pair', () => {
    expect(tabIndexOfRow(window4, new Set(['a']), 1)).toBe(2);
  });
});

describe('slotOutsidePairs (KAN-942)', () => {
  test('a slot inside a pair steps past it', () => {
    expect(slotOutsidePairs(window4, none, 2)).toBe(3);
  });

  test('a slot at a pair edge stays', () => {
    expect(slotOutsidePairs(window4, none, 1)).toBe(1);
    expect(slotOutsidePairs(window4, none, 3)).toBe(3);
  });

  test('a slot between a broken pair stays', () => {
    expect(slotOutsidePairs(broken, new Set(['h']), 1)).toBe(1);
  });

  test('counted with the held tab out', () => {
    expect(slotOutsidePairs(window4, new Set(['a']), 1)).toBe(2);
  });
});

describe('item indices (KAN-942)', () => {
  const group = { groupId: 'g', title: 'G', color: 'blue' };
  const tabs = [
    tab('a'),
    half('h1'),
    half('h2'),
    tab('m', { chromeGroupId: 'g' }),
    tab('b'),
  ];
  const items = partitionTabsIntoItems(tabs, [group]);
  const followers = savedFollowerIds(tabs);

  test('itemIndexOfRow counts a pair as one item', () => {
    expect(itemIndexOfRow(items, followers, 2)).toBe(3);
  });

  test('past the last row is the list end', () => {
    expect(itemIndexOfRow(items, followers, 4)).toBe(items.length);
  });

  test('itemSlotOutsidePairs steps past a follower', () => {
    expect(itemSlotOutsidePairs(items, followers, 2)).toBe(3);
  });

  test('itemSlotOutsidePairs leaves any other slot', () => {
    expect(itemSlotOutsidePairs(items, followers, 3)).toBe(3);
  });
});
