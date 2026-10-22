import { afterEach, describe, expect, test } from 'vitest';

import { toOpenWindows } from '../../../utils/functions/openNow';
import type {
  OpenGroup,
  OpenTab,
  OpenWindow,
} from '../../../utils/functions/openNow';
import {
  countMatchedTabs,
  matchOpenWindows,
  openTabTextMatches,
  searchTermOf,
} from '../../../utils/functions/openNowSearch';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

// Every field an OpenTab has, so the fixtures are real OpenTabs without a cast.
const tab = (
  id: number,
  windowId: number,
  title: string,
  url: string,
  groupId: number | null = null
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
  groupId,
  index: 0,
});

const group = (id: number, title: string): OpenGroup => ({
  id,
  title,
  color: 'blue',
  collapsed: false,
});

const win = (
  id: number,
  tabs: OpenTab[],
  groups: OpenGroup[] = []
): OpenWindow => ({
  id,
  isThisWindow: false,
  tabs,
  groups,
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

describe('openTabTextMatches', () => {
  const kyoto = tab(
    1,
    1,
    'Kyoto saved places - Google Maps',
    'https://maps.google.com/kyoto'
  );
  test('matches the title, ignoring case', () => {
    expect(openTabTextMatches(kyoto, 'kyoto saved')).toBe(true);
  });
  test('matches the address when the title does not', () => {
    expect(openTabTextMatches(kyoto, 'maps.google')).toBe(true);
  });
  test('an upper-case address still matches a lower-case term', () => {
    expect(
      openTabTextMatches(tab(2, 1, 'Docs', 'https://EXAMPLE.test/'), 'example')
    ).toBe(true);
  });
  test('no match on either', () => {
    expect(openTabTextMatches(kyoto, 'osaka')).toBe(false);
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

describe('matchOpenWindows: group titles (KAN-718)', () => {
  // Window 1: a "Kyoto trip" group of two tabs whose own titles say nothing
  // of Kyoto, an unrelated "Kyoto ramen" tab, and an untitled group.
  const windows = [
    win(
      1,
      [
        tab(11, 1, 'Hotel booking', 'https://hotel.test/', 5),
        tab(12, 1, 'JR pass', 'https://rail.test/', 5),
        tab(13, 1, 'Kyoto ramen guide', 'https://food.test/'),
        tab(14, 1, 'Inbox', 'https://mail.test/', 6),
        tab(15, 1, 'Docs', 'https://docs.test/'),
      ],
      [group(5, 'Kyoto trip'), group(6, '')]
    ),
    win(
      2,
      [tab(21, 2, 'Weather', 'https://weather.test/', 9)],
      [group(9, 'Osaka')]
    ),
  ];

  test('a term only a group title holds draws every tab in that group', () => {
    const matches = matchOpenWindows(windows, 'trip');
    expect([...matches.keys()]).toEqual([1]);
    expect([...(matches.get(1) ?? [])]).toEqual([11, 12]);
  });

  test('a term matching a group and an unrelated tab draws both, in tab order', () => {
    const matches = matchOpenWindows(windows, 'kyoto');
    expect([...(matches.get(1) ?? [])]).toEqual([11, 12, 13]);
    expect(countMatchedTabs(matches)).toBe(3);
  });

  test('a group title matches ignoring case', () => {
    expect([...(matchOpenWindows(windows, 'osaka').get(2) ?? [])]).toEqual([
      21,
    ]);
  });

  test('a tab matching itself and its group counts once', () => {
    const own = [
      win(
        1,
        [
          tab(11, 1, 'Kyoto hotel', 'https://hotel.test/', 5),
          tab(12, 1, 'JR pass', 'https://rail.test/', 5),
        ],
        [group(5, 'Kyoto trip')]
      ),
    ];
    expect(countMatchedTabs(matchOpenWindows(own, 'kyoto'))).toBe(2);
  });

  test('an untitled group matches nothing', () => {
    expect(matchOpenWindows(windows, 'inbox').get(1)).toEqual(new Set([14]));
    expect(matchOpenWindows(windows, 'mail').get(1)).toEqual(new Set([14]));
    expect(countMatchedTabs(matchOpenWindows(windows, 'zzz'))).toBe(0);
  });
});

describe('matchOpenWindows on what toOpenWindows reads (KAN-718)', () => {
  let handle: ChromeFakeHandle | undefined;
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  // The fixtures above hand-build OpenWindows; this reads Chrome's groups
  // through the real reshape, so a reshape that dropped a group's title
  // fails here. The grant gate itself is useOpenWindows' (useOpenWindows.test).
  test("a live group's title reaches the match through toOpenWindows", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://hotel.test/', title: 'Hotel', groupId: 5 },
            { url: 'https://rail.test/', title: 'JR pass', groupId: 5 },
          ],
        },
      ],
      tabGroups: [{ id: 5, title: 'Kyoto trip', color: 'blue', windowId: 1 }],
    });
    const chromeWindows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    const chromeGroups = await chrome.tabGroups.query({});

    const windows = toOpenWindows(chromeWindows, chromeGroups, null);
    expect(countMatchedTabs(matchOpenWindows(windows, 'kyoto'))).toBe(2);
  });
});
