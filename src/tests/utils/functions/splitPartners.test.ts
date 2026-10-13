import { describe, expect, test } from 'vitest';

import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import type { OpenTab } from '../../../utils/functions/openNow';
import {
  openSplitPartners,
  savedSplitPartners,
} from '../../../utils/functions/splitPartners';

const saved = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: `Title ${tabId}`,
  url: `https://example.com/${tabId}`,
  ...extra,
});

const open = (id: number, splitViewId?: number): OpenTab => ({
  id,
  windowId: 1,
  title: `Tab ${id}`,
  url: `https://example.com/${id}`,
  favIconUrl: '',
  active: false,
  pinned: false,
  audible: false,
  muted: false,
  groupId: null,
  index: id,
  ...(splitViewId === undefined ? {} : { splitViewId }),
});

const titles = (partners: Map<string, tabData>) =>
  Object.fromEntries([...partners].map(([id, tab]) => [id, tab.title]));

describe('savedSplitPartners (KAN-564)', () => {
  test('each half of a pair names the other; tabs outside a pair are absent', () => {
    const tabs = [
      saved('a'),
      saved('b', { splitId: 's1' }),
      saved('c', { splitId: 's1' }),
      saved('d'),
    ];
    expect(titles(savedSplitPartners(tabs))).toEqual({
      b: 'Title c',
      c: 'Title b',
    });
  });

  test('a pair a restore would not split is not marked: apart, pinned unlike, or in different groups', () => {
    const apart = [
      saved('a', { splitId: 's1' }),
      saved('b'),
      saved('c', { splitId: 's1' }),
    ];
    const pinnedUnlike = [
      saved('a', { splitId: 's1', pinned: true }),
      saved('b', { splitId: 's1' }),
    ];
    const groupsUnlike = [
      saved('a', { splitId: 's1', chromeGroupId: 'g1' }),
      saved('b', { splitId: 's1' }),
    ];
    for (const tabs of [apart, pinnedUnlike, groupsUnlike])
      expect(savedSplitPartners(tabs).size).toBe(0);
  });

  test('a lone half, or three tabs on one splitId, marks nothing', () => {
    expect(savedSplitPartners([saved('a', { splitId: 's1' })]).size).toBe(0);
    expect(
      savedSplitPartners([
        saved('a', { splitId: 's1' }),
        saved('b', { splitId: 's1' }),
        saved('c', { splitId: 's1' }),
      ]).size
    ).toBe(0);
  });
});

describe('openSplitPartners (KAN-564)', () => {
  test('each half of a live split names the other; two splits stay apart', () => {
    const partners = openSplitPartners([
      open(1),
      open(2, 70),
      open(3, 70),
      open(4, 80),
      open(5, 80),
    ]);
    expect(
      Object.fromEntries([...partners].map(([id, tab]) => [id, tab.id]))
    ).toEqual({ 2: 3, 3: 2, 4: 5, 5: 4 });
  });

  test('a half this pane leaves out leaves the drawn half unmarked', () => {
    expect(openSplitPartners([open(1), open(2, 70)]).size).toBe(0);
  });
});
