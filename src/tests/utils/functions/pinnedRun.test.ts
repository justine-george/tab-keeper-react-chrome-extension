import { describe, expect, test } from 'vitest';

import {
  noRowsTabIndex,
  forgetMissingActiveTab,
  groupLandingRange,
  isPinnedSlot,
  isTabPinnedIn,
  landTab,
  pinnedRunLength,
} from '../../../utils/functions/pinnedRun';
import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../../redux/slices/tabContainerDataStateSlice';

// KAN-458. Position decides a dropped tab's pin; a saved window keeps Chrome's leading pinned run.
const t = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test/`,
  ...extra,
});
const p = (tabId: string) => t(tabId, { pinned: true });

describe('pinnedRunLength', () => {
  test('counts the leading pinned tabs', () => {
    expect(pinnedRunLength([p('a'), p('b'), t('c')])).toBe(2);
  });

  test('none pinned: 0', () => {
    expect(pinnedRunLength([t('a'), t('b')])).toBe(0);
  });

  test('all pinned: the length', () => {
    expect(pinnedRunLength([p('a'), p('b')])).toBe(2);
  });

  test('a pinned tab after an unpinned one is not in the run', () => {
    expect(pinnedRunLength([p('a'), t('b'), p('c')])).toBe(1);
  });
});

describe('isPinnedSlot', () => {
  // others = [p, p, u, u]: slots 0 and 1 are inside the run, 2 is the boundary, 3 and 4 are past it.
  const others = [p('a'), p('b'), t('c'), t('d')];
  const cases: [string, number, boolean, boolean][] = [
    [
      'above the first pinned tab, an unpinned tab becomes pinned',
      0,
      false,
      true,
    ],
    ['between two pinned tabs, an unpinned tab becomes pinned', 1, false, true],
    ['among the unpinned tabs, a pinned tab becomes unpinned', 3, true, false],
    ['at the bottom, a pinned tab becomes unpinned', 4, true, false],
    ['on the boundary, a pinned tab stays pinned', 2, true, true],
    ['on the boundary, an unpinned tab stays unpinned', 2, false, false],
  ];

  test.each(cases)('%s', (_, toIndex, wasPinned, expected) => {
    expect(isPinnedSlot(others, toIndex, wasPinned)).toBe(expected);
  });

  test('no pinned tabs: the top is the boundary, so an unpinned tab stays unpinned', () => {
    expect(isPinnedSlot([t('a'), t('b')], 0, false)).toBe(false);
  });

  test('no pinned tabs: a pinned tab carried to the top keeps its pin (R2)', () => {
    expect(isPinnedSlot([t('a'), t('b')], 0, true)).toBe(true);
  });

  test('every other tab pinned: the bottom is the boundary, so a pinned tab stays pinned', () => {
    expect(isPinnedSlot([p('a'), p('b')], 2, true)).toBe(true);
  });
});

describe('landTab', () => {
  const others = [p('a'), t('b')];

  test('into a band: joins it and is unpinned, wherever it is (A6)', () => {
    const tab = p('x');
    landTab(tab, others, 0, 'g');
    expect(tab).toEqual(t('x', { chromeGroupId: 'g' }));
    expect('pinned' in tab).toBe(false);
  });

  test('loose among the pinned tabs: pinned, and out of its old group', () => {
    const tab = t('x', { chromeGroupId: 'g' });
    landTab(tab, others, 0, undefined);
    expect(tab).toEqual(p('x'));
    expect('chromeGroupId' in tab).toBe(false);
  });

  test('loose among the unpinned tabs: unpinned, with no pinned key', () => {
    const tab = p('x');
    landTab(tab, others, 2, undefined);
    expect('pinned' in tab).toBe(false);
  });
});

describe('groupLandingRange', () => {
  const range = groupLandingRange(
    [
      { windowId: 'w1', tabs: [p('a'), p('b'), t('c')] },
      { windowId: 'w2', tabs: [t('d')] },
      { windowId: 'w3', tabs: [p('e'), t('f')] },
    ],
    (windowId) => windowId === 'w3'
  );

  test("starts past the window's pinned run", () => {
    expect(range('group:g', 'w1').min).toBe(2);
  });

  test('a window with no pinned tabs starts at the top', () => {
    expect(range('group:g', 'w2').min).toBe(0);
  });

  test('a new-window target or no window: no floor', () => {
    expect(range('group:g', undefined).min).toBe(0);
    expect(range('group:g', 'not-a-window').min).toBe(0);
  });

  test('no ceiling: the engine bounds it to the rows that exist', () => {
    expect(range('group:g', 'w1').max).toBe(Number.MAX_SAFE_INTEGER);
  });

  test('a window drawn with no rows: floor 0, so its one slot is not refused', () => {
    expect(range('group:g', 'w3').min).toBe(0);
  });
});

describe('noRowsTabIndex (edge ruling: a window drawn with no rows keeps the pin)', () => {
  const target = [p('a'), p('b'), t('c')];

  test('a pinned tab: index 0', () => {
    expect(noRowsTabIndex(target, true)).toBe(0);
  });

  test('an unpinned tab: right after the pinned run', () => {
    expect(noRowsTabIndex(target, false)).toBe(2);
  });

  test('a window with no pinned tabs: index 0 either way', () => {
    expect(noRowsTabIndex([t('c')], false)).toBe(0);
    expect(noRowsTabIndex([t('c')], true)).toBe(0);
  });

  test('a tab of any id there is counted: a carried tab may share one until it is re-minted', () => {
    expect(noRowsTabIndex([p('x'), p('a'), t('c')], false)).toBe(2);
  });

  test('at the index it gives, isPinnedSlot keeps the pin', () => {
    expect(isPinnedSlot(target, noRowsTabIndex(target, true), true)).toBe(true);
    expect(isPinnedSlot(target, noRowsTabIndex(target, false), false)).toBe(
      false
    );
  });
});

describe('isTabPinnedIn', () => {
  const sessions: tabContainerData[] = [
    {
      tabGroupId: 'S1',
      title: 's',
      createdTime: '2026-10-07 09:00:00',
      windowCount: 1,
      tabCount: 2,
      isAutoSave: false,
      isSelected: false,
      windows: [
        {
          windowId: 'w1',
          windowHeight: 1,
          windowWidth: 1,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 2,
          title: '',
          tabs: [p('a'), t('b')],
        },
      ],
    },
  ];

  test('a pinned tab, found by session, window and id', () => {
    expect(
      isTabPinnedIn(sessions, { tabGroupId: 'S1', windowId: 'w1', tabId: 'a' })
    ).toBe(true);
  });

  test('an unpinned tab, or one that is gone: false', () => {
    expect(
      isTabPinnedIn(sessions, { tabGroupId: 'S1', windowId: 'w1', tabId: 'b' })
    ).toBe(false);
    expect(
      isTabPinnedIn(sessions, { tabGroupId: 'S9', windowId: 'w1', tabId: 'a' })
    ).toBe(false);
  });
});

describe('forgetMissingActiveTab', () => {
  const w = (
    tabs: tabData[],
    activeTabId: string
  ): Pick<windowGroupData, 'tabs' | 'activeTabId'> => ({ tabs, activeTabId });

  test('drops an id that names no tab in the window', () => {
    const win = w([t('a')], 'gone');
    forgetMissingActiveTab(win);
    expect('activeTabId' in win).toBe(false);
  });

  test('keeps an id that names a tab', () => {
    const win = w([t('a')], 'a');
    forgetMissingActiveTab(win);
    expect(win.activeTabId).toBe('a');
  });
});
