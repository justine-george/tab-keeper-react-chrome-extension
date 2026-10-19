import { describe, expect, test } from 'vitest';

import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { generatePlaceholderURL } from '../../utils/functions/local';
import {
  isSavedWindowSortedBySite,
  isSortedBySite,
  savedSortable,
  siteOf,
  sortBySite,
  type SortableTab,
} from '../../utils/functions/sortBySite';

const t = (
  key: string,
  url: string,
  opts: Partial<Omit<SortableTab, 'key' | 'url'>> = {}
): SortableTab => ({
  key,
  url,
  pinned: false,
  groupKey: null,
  splitKey: null,
  ...opts,
});

const keys = (tabs: readonly SortableTab[]) => tabs.map((x) => x.key);

describe('siteOf', () => {
  test('lowercases, drops one leading www and the port', () => {
    expect(siteOf('https://WWW.Example.com:8080/a')).toBe('example.com');
    expect(siteOf('http://www.www.example.com/')).toBe('www.example.com');
  });

  test('gives no site to anything that is not http or https', () => {
    for (const url of [
      'chrome://settings',
      'about:blank',
      '',
      'file:///x',
      'data:text/html,hi',
      'not a url',
    ]) {
      expect(siteOf(url)).toBeNull();
    }
  });
});

describe('sortBySite', () => {
  test("the mock window sorts as the spec's example", () => {
    const g = { groupKey: 'kyoto' };
    const input = [
      t('Gmail', 'https://mail.google.com/', { pinned: true }),
      t('Calendar', 'https://calendar.google.com/', { pinned: true }),
      t('GitHub#412', 'https://github.com/a/412'),
      t('Docs Q4', 'https://docs.google.com/q4'),
      t('MDN toSorted', 'https://developer.mozilla.org/toSorted'),
      t('GitHub#98', 'https://github.com/a/98'),
      t('Booking', 'https://booking.com/', g),
      t('Maps', 'https://maps.google.com/', g),
      t('Wikipedia', 'https://en.wikipedia.org/kyoto', g),
      t('YouTube calm', 'https://www.youtube.com/calm'),
      t('Docs launch', 'https://docs.google.com/launch'),
      t('Wikipedia tab', 'https://en.wikipedia.org/tab'),
      t('GitHub actions', 'https://github.com/a/actions'),
      t('MDN corner-shape', 'https://developer.mozilla.org/corner-shape'),
      t('YouTube ext', 'https://www.youtube.com/ext'),
      t('Docs notes', 'https://docs.google.com/notes'),
    ];
    expect(input).toHaveLength(16);
    expect(keys(sortBySite(input))).toEqual([
      'Gmail',
      'Calendar',
      'Booking',
      'Maps',
      'Wikipedia',
      'GitHub#412',
      'GitHub#98',
      'GitHub actions',
      'Docs Q4',
      'Docs launch',
      'Docs notes',
      'MDN toSorted',
      'MDN corner-shape',
      'YouTube calm',
      'YouTube ext',
      'Wikipedia tab',
    ]);
  });

  test('pinned sort among pinned, first-seen', () => {
    const out = sortBySite([
      t('1', 'https://b.com/1', { pinned: true }),
      t('2', 'https://a.com/', { pinned: true }),
      t('3', 'https://b.com/3', { pinned: true }),
    ]);
    expect(keys(out)).toEqual(['1', '3', '2']);
  });

  test('pinned stay ahead of groups and loose tabs', () => {
    const out = sortBySite([
      t('loose', 'https://a.com/'),
      t('g', 'https://a.com/', { groupKey: 'G' }),
      t('p', 'https://z.com/', { pinned: true }),
    ]);
    expect(keys(out)).toEqual(['p', 'g', 'loose']);
  });

  test('groups move up after pinned, in first-seen order, contents untouched', () => {
    const out = sortBySite([
      t('l1', 'https://a.com/'),
      t('b1', 'https://z.com/', { groupKey: 'B' }),
      t('b2', 'https://a.com/', { groupKey: 'B' }),
      t('a1', 'https://m.com/', { groupKey: 'A' }),
      t('l2', 'https://a.com/2'),
    ]);
    expect(keys(out)).toEqual(['b1', 'b2', 'a1', 'l1', 'l2']);
  });

  test('scattered group members are gathered at the first member', () => {
    const out = sortBySite([
      t('x1', 'https://a.com/', { groupKey: 'X' }),
      t('y1', 'https://a.com/', { groupKey: 'Y' }),
      t('x2', 'https://a.com/', { groupKey: 'X' }),
    ]);
    expect(keys(out)).toEqual(['x1', 'x2', 'y1']);
  });

  test('a pinned tab in a group counts as a group member', () => {
    const out = sortBySite([
      t('loose', 'https://a.com/'),
      t('pg', 'https://a.com/', { pinned: true, groupKey: 'G' }),
      t('p', 'https://b.com/', { pinned: true }),
    ]);
    expect(keys(out)).toEqual(['p', 'pg', 'loose']);
  });

  test("a site's tabs keep their order; sites in first-seen order", () => {
    const out = sortBySite([
      t('z1', 'https://zeta.com/1'),
      t('a1', 'https://alpha.com/1'),
      t('z2', 'https://zeta.com/2'),
      t('a2', 'https://alpha.com/2'),
    ]);
    expect(keys(out)).toEqual(['z1', 'z2', 'a1', 'a2']);
  });

  test('no-site tabs go last in their section, in order', () => {
    const out = sortBySite([
      t('s', 'chrome://settings'),
      t('a', 'https://a.com/'),
      t('blank', 'about:blank'),
      t('empty', ''),
      t('b', 'https://b.com/'),
      t('f', 'file:///x'),
      t('a2', 'https://a.com/2'),
    ]);
    expect(keys(out)).toEqual(['a', 'a2', 'b', 's', 'blank', 'empty', 'f']);
  });

  test('www and case are folded; port is ignored', () => {
    const out = sortBySite([
      t('1', 'https://WWW.Example.com:8080/a'),
      t('2', 'https://other.com/'),
      t('3', 'https://example.com/b'),
    ]);
    expect(keys(out)).toEqual(['1', '3', '2']);
  });

  test('sorts a lazy placeholder by the page it stands for', () => {
    const placeholder = generatePlaceholderURL(
      'Title',
      'favicon',
      'https://example.com/page',
      'go'
    );
    expect(siteOf(placeholder)).toBe('example.com');
    const out = sortBySite([
      t('1', 'https://example.com/'),
      t('2', 'https://other.com/'),
      t('3', placeholder),
    ]);
    expect(keys(out)).toEqual(['1', '3', '2']);
  });

  test('an adjacent split pair moves as one unit; separated halves are plain tabs', () => {
    const adjacent = sortBySite([
      t('a1', 'https://a.com/1'),
      t('s1', 'https://b.com/', { splitKey: 'S' }),
      t('s2', 'https://a.com/2', { splitKey: 'S' }),
      t('a3', 'https://a.com/3'),
    ]);
    // the pair takes its first tab's site (b.com), so it stays together after a.com
    expect(keys(adjacent)).toEqual(['a1', 'a3', 's1', 's2']);

    const apart = sortBySite([
      t('s1', 'https://b.com/', { splitKey: 'S' }),
      t('a1', 'https://a.com/1'),
      t('s2', 'https://a.com/2', { splitKey: 'S' }),
      t('b2', 'https://b.com/2'),
    ]);
    expect(keys(apart)).toEqual(['s1', 'b2', 'a1', 's2']);
  });

  test('three tabs sharing a split key are plain tabs', () => {
    const out = sortBySite([
      t('a1', 'https://a.com/'),
      t('s1', 'https://b.com/', { splitKey: 'S' }),
      t('s2', 'https://c.com/', { splitKey: 'S' }),
      t('s3', 'https://b.com/3', { splitKey: 'S' }),
    ]);
    expect(keys(out)).toEqual(['a1', 's1', 's3', 's2']);
  });

  test('a loose tab and a grouped tab never pair', () => {
    const out = sortBySite([
      t('l0', 'https://c.com/'),
      t('l', 'https://b.com/', { splitKey: 'S' }),
      t('g', 'https://b.com/2', { splitKey: 'S', groupKey: 'G' }),
    ]);
    expect(keys(out)).toEqual(['g', 'l0', 'l']);
  });

  test('a pinned tab and a loose tab never pair', () => {
    const out = sortBySite([
      t('l0', 'https://c.com/'),
      t('p', 'https://b.com/', { pinned: true, splitKey: 'S' }),
      t('l', 'https://b.com/2', { splitKey: 'S' }),
    ]);
    expect(keys(out)).toEqual(['p', 'l0', 'l']);
  });

  test('separated halves are sorted on their own sites', () => {
    const out = sortBySite([
      t('x', 'https://x.com/'),
      t('s1', 'https://b.com/', { splitKey: 'S' }),
      t('a1', 'https://a.com/1'),
      t('s2', 'https://x.com/2', { splitKey: 'S' }),
    ]);
    expect(keys(out)).toEqual(['x', 's2', 's1', 'a1']);
  });

  test('returns a new array of the same objects', () => {
    const input = [t('1', 'https://a.com/'), t('2', 'https://b.com/')];
    const out = sortBySite(input);
    expect(out).not.toBe(input);
    expect(out[0]).toBe(input[0]);
  });
});

describe('isSortedBySite', () => {
  test('already sorted: true, and sortBySite returns the same order', () => {
    const input = [
      t('p', 'https://a.com/', { pinned: true }),
      t('g', 'https://a.com/', { groupKey: 'G' }),
      t('1', 'https://b.com/1'),
      t('2', 'https://b.com/2'),
      t('3', 'https://c.com/'),
    ];
    expect(isSortedBySite(input)).toBe(true);
    expect(keys(sortBySite(input))).toEqual(keys(input));
  });

  test('false when a site is split up', () => {
    expect(
      isSortedBySite([
        t('1', 'https://b.com/'),
        t('2', 'https://a.com/'),
        t('3', 'https://b.com/2'),
      ])
    ).toBe(false);
  });

  test('only pinned, one site, and empty windows are sorted', () => {
    expect(
      isSortedBySite([
        t('1', 'https://a.com/', { pinned: true }),
        t('2', 'https://b.com/', { pinned: true }),
      ])
    ).toBe(true);
    expect(
      isSortedBySite([t('1', 'https://a.com/1'), t('2', 'https://a.com/2')])
    ).toBe(true);
    expect(isSortedBySite([])).toBe(true);
  });
});

const saved = (
  tabId: string,
  url: string,
  extra: Partial<tabData> = {}
): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url,
  ...extra,
});

const savedWindow = (tabs: tabData[]): windowGroupData => ({
  windowId: 'w',
  windowHeight: 1,
  windowWidth: 1,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: 'w',
  tabs,
});

describe('savedSortable', () => {
  test('maps the saved fields and keeps the tab', () => {
    const tab = saved('1', 'https://a.com/', {
      pinned: true,
      chromeGroupId: 'g',
      splitId: 's',
    });
    expect(savedSortable(tab)).toEqual({
      ...tab,
      key: '1',
      pinned: true,
      groupKey: 'g',
      splitKey: 's',
    });
    expect(savedSortable(saved('2', 'https://a.com/'))).toMatchObject({
      pinned: false,
      groupKey: null,
      splitKey: null,
    });
  });
});

describe('isSavedWindowSortedBySite', () => {
  test('false for a scattered site, true once gathered', () => {
    const a = saved('a', 'https://a.com/');
    const b = saved('b', 'https://b.com/');
    const a2 = saved('a2', 'https://a.com/2');
    expect(isSavedWindowSortedBySite(savedWindow([a, b, a2]))).toBe(false);
    expect(isSavedWindowSortedBySite(savedWindow([a, a2, b]))).toBe(true);
  });
});
