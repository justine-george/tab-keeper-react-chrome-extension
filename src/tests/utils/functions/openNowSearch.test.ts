import { describe, expect, test } from 'vitest';

import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import {
  countMatchedTabs,
  matchOpenWindows,
  openTabMatches,
  searchTermOf,
} from '../../../utils/functions/openNowSearch';

// Every field an OpenTab has, so the fixtures are real OpenTabs without a cast.
const tab = (
  id: number,
  windowId: number,
  title: string,
  url: string
): OpenTab => ({
  id,
  windowId,
  title,
  url,
  favIconUrl: '',
  active: false,
  pinned: false,
  audible: false,
  muted: false,
  groupId: null,
  index: 0,
});

const win = (id: number, tabs: OpenTab[]): OpenWindow => ({
  id,
  isThisWindow: false,
  tabs,
  groups: [],
  bounds: null,
  state: 'normal',
  incognito: false,
});

describe('searchTermOf (KAN-330 O14a)', () => {
  test('lower-cases and trims', () => {
    expect(searchTermOf('  Kyoto ')).toBe('kyoto');
  });
  test('empty and spaces-only are no search', () => {
    expect(searchTermOf('')).toBeNull();
    expect(searchTermOf('   ')).toBeNull();
  });
  test('inner spaces are kept', () => {
    expect(searchTermOf('Rail  Pass')).toBe('rail  pass');
  });
});

describe('openTabMatches', () => {
  const kyoto = tab(
    1,
    1,
    'Kyoto saved places - Google Maps',
    'https://maps.google.com/kyoto'
  );
  test('matches the title, ignoring case', () => {
    expect(openTabMatches(kyoto, 'kyoto saved')).toBe(true);
  });
  test('matches the address when the title does not', () => {
    expect(openTabMatches(kyoto, 'maps.google')).toBe(true);
  });
  test('an upper-case address still matches a lower-case term', () => {
    expect(
      openTabMatches(tab(2, 1, 'Docs', 'https://EXAMPLE.test/'), 'example')
    ).toBe(true);
  });
  test('no match on either', () => {
    expect(openTabMatches(kyoto, 'osaka')).toBe(false);
  });
});

describe('matchOpenWindows', () => {
  const windows = [
    win(1, [
      tab(11, 1, 'Alpha', 'https://a.test/'),
      tab(12, 1, 'Beta', 'https://b.test/'),
    ]),
    win(2, [tab(21, 2, 'Gamma', 'https://c.test/')]),
    win(3, [tab(31, 3, 'Alpha two', 'https://d.test/')]),
  ];
  test('maps each window with a match to the ids of its matching tabs', () => {
    const matches = matchOpenWindows(windows, 'alpha');
    expect([...matches.keys()]).toEqual([1, 3]);
    expect([...(matches.get(1) ?? [])]).toEqual([11]);
    expect([...(matches.get(3) ?? [])]).toEqual([31]);
  });
  test('a window with no match has no entry', () => {
    expect(matchOpenWindows(windows, 'alpha').has(2)).toBe(false);
  });
  test('no match anywhere is an empty map', () => {
    expect(matchOpenWindows(windows, 'zzz').size).toBe(0);
  });
  test('countMatchedTabs sums every window', () => {
    expect(countMatchedTabs(matchOpenWindows(windows, 'a'))).toBe(4);
  });
});
