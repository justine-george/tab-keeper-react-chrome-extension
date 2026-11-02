import { afterEach, describe, expect, test } from 'vitest';

import type {
  OpenGroup,
  OpenTab,
  OpenWindow,
} from '../../../utils/functions/openNow';
import {
  findOpenGroup,
  hasOpenGroup,
  openGroupKeys,
  switchToOpenGroup,
} from '../../../utils/functions/openSavedGroup';
import type { TabGroupColor } from '../../../utils/functions/tabGroups';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

// KAN-885. A saved group's Open switches to an open group with the same name,
// the same number of tabs and the same addresses as a set.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
});

let nextId = 100;
const tab = (url: string, extra: Partial<OpenTab> = {}): OpenTab => ({
  id: nextId++,
  windowId: 0,
  title: url,
  url,
  favIconUrl: '',
  active: false,
  pinned: false,
  audible: false,
  muted: false,
  groupId: null,
  index: 0,
  ...extra,
});

const group = (
  id: number,
  title: string,
  color: TabGroupColor = 'blue'
): OpenGroup => ({
  id,
  title,
  color,
  collapsed: false,
});

const win = (
  id: number,
  tabs: OpenTab[],
  groups: OpenGroup[],
  isThisWindow = false
): OpenWindow => ({
  id,
  isThisWindow,
  tabs: tabs.map((t) => ({ ...t, windowId: id })),
  groups,
  bounds: null,
  state: 'normal',
  incognito: false,
});

const A = 'https://a.test/';
const B = 'https://b.test/';
const C = 'https://c.test/';
const SUSPENDED_A =
  'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=A&url=https%3A%2F%2Fa.test%2F&time=1788097428448';

const work = { title: 'Work', urls: [A, B] };

describe('findOpenGroup', () => {
  test('finds a group with the same name and addresses in another window', () => {
    const windows = [
      win(1, [tab(C)], [], true),
      win(
        2,
        [tab(A, { groupId: 7 }), tab(B, { groupId: 7 })],
        [group(7, 'Work')]
      ),
    ];
    const found = findOpenGroup(work, windows);
    expect(found?.windowId).toBe(2);
    expect(found?.tabs.map((t) => t.url)).toEqual([A, B]);
  });

  test('ignores the order of the tabs and the colour of the group', () => {
    const windows = [
      win(
        2,
        [tab(B, { groupId: 7 }), tab(A, { groupId: 7 })],
        [group(7, 'Work', 'red')]
      ),
    ];
    expect(findOpenGroup(work, windows)?.windowId).toBe(2);
  });

  test('no match when the name differs, even by case', () => {
    const windows = [
      win(
        2,
        [tab(A, { groupId: 7 }), tab(B, { groupId: 7 })],
        [group(7, 'work')]
      ),
    ];
    expect(findOpenGroup(work, windows)).toBeUndefined();
  });

  test('no match when the open group has a tab more or a tab fewer', () => {
    const more = [
      win(
        2,
        [
          tab(A, { groupId: 7 }),
          tab(B, { groupId: 7 }),
          tab(C, { groupId: 7 }),
        ],
        [group(7, 'Work')]
      ),
    ];
    const fewer = [win(2, [tab(A, { groupId: 7 })], [group(7, 'Work')])];
    expect(findOpenGroup(work, more)).toBeUndefined();
    expect(findOpenGroup(work, fewer)).toBeUndefined();
  });

  test('no match when the open group holds a second copy of a saved tab', () => {
    const windows = [
      win(
        2,
        [
          tab(A, { groupId: 7 }),
          tab(B, { groupId: 7 }),
          tab(B, { groupId: 7 }),
        ],
        [group(7, 'Work')]
      ),
    ];
    expect(findOpenGroup(work, windows)).toBeUndefined();
  });

  test('no match once a tab in the open group has gone elsewhere', () => {
    const windows = [
      win(
        2,
        [tab(A, { groupId: 7 }), tab(C, { groupId: 7 })],
        [group(7, 'Work')]
      ),
    ];
    expect(findOpenGroup(work, windows)).toBeUndefined();
  });

  test('no match for the same tabs outside a group', () => {
    const windows = [win(2, [tab(A), tab(B)], [])];
    expect(findOpenGroup(work, windows)).toBeUndefined();
  });

  test('a suspended open tab counts as the address it wraps', () => {
    const windows = [
      win(
        2,
        [tab(SUSPENDED_A, { groupId: 7 }), tab(B, { groupId: 7 })],
        [group(7, 'Work')]
      ),
    ];
    expect(findOpenGroup(work, windows)?.windowId).toBe(2);
  });

  test('addresses compare as a set: saved a, a, b matches open a, b, b', () => {
    const windows = [
      win(
        2,
        [
          tab(A, { groupId: 7 }),
          tab(B, { groupId: 7 }),
          tab(B, { groupId: 7 }),
        ],
        [group(7, 'Work')]
      ),
    ];
    expect(
      findOpenGroup({ title: 'Work', urls: [A, A, B] }, windows)?.windowId
    ).toBe(2);
  });

  test('an unnamed saved group matches an unnamed open group', () => {
    const windows = [
      win(2, [tab(A, { groupId: 7 }), tab(B, { groupId: 7 })], [group(7, '')]),
    ];
    expect(findOpenGroup({ title: '', urls: [A, B] }, windows)?.windowId).toBe(
      2
    );
  });

  test('picks the matching group when a window holds two with the name', () => {
    const windows = [
      win(
        2,
        [
          tab(A, { groupId: 7 }),
          tab(C, { groupId: 7 }),
          tab(A, { groupId: 8 }),
          tab(B, { groupId: 8 }),
        ],
        [group(7, 'Work'), group(8, 'Work')]
      ),
    ];
    expect(findOpenGroup(work, windows)?.tabs.map((t) => t.groupId)).toEqual([
      8, 8,
    ]);
  });

  test("Tab Keeper's own window first, even when another was used later", () => {
    const windows = [
      win(
        2,
        [tab(A, { groupId: 7, lastAccessed: 90 }), tab(B, { groupId: 7 })],
        [group(7, 'Work')]
      ),
      win(
        1,
        [tab(A, { groupId: 3, lastAccessed: 10 }), tab(B, { groupId: 3 })],
        [group(3, 'Work')],
        true
      ),
    ];
    expect(findOpenGroup(work, windows)?.windowId).toBe(1);
  });

  test('else the group used last', () => {
    const windows = [
      win(
        2,
        [tab(A, { groupId: 7, lastAccessed: 10 }), tab(B, { groupId: 7 })],
        [group(7, 'Work')]
      ),
      win(
        3,
        [tab(A, { groupId: 9 }), tab(B, { groupId: 9, lastAccessed: 50 })],
        [group(9, 'Work')]
      ),
      win(1, [tab(C)], [], true),
    ];
    expect(findOpenGroup(work, windows)?.windowId).toBe(3);
  });
});

describe('hasOpenGroup', () => {
  test('agrees with findOpenGroup on a match and on drift', () => {
    const open = [
      win(
        2,
        [tab(B, { groupId: 7 }), tab(SUSPENDED_A, { groupId: 7 })],
        [group(7, 'Work')]
      ),
    ];
    const drifted = [
      win(
        2,
        [tab(A, { groupId: 7 }), tab(C, { groupId: 7 })],
        [group(7, 'Work')]
      ),
    ];
    expect(hasOpenGroup(work, openGroupKeys(open))).toBe(true);
    expect(hasOpenGroup(work, openGroupKeys(drifted))).toBe(false);
    expect(
      hasOpenGroup({ title: 'Other', urls: [A, B] }, openGroupKeys(open))
    ).toBe(false);
  });
});

describe('switchToOpenGroup', () => {
  const activeIn = async (windowId: number) =>
    (await chrome.tabs.query({ active: true, windowId }))[0];

  test("activates the group's last used tab and focuses its window", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [{ id: 10, url: C, active: true }],
        },
        {
          id: 2,
          focused: false,
          tabs: [
            { id: 20, url: C, active: true },
            { id: 21, url: A, groupId: 7, lastAccessed: 5 },
            { id: 22, url: B, groupId: 7, lastAccessed: 9 },
          ],
        },
      ],
      tabGroups: [{ id: 7, windowId: 2, title: 'Work', color: 'blue' }],
    });

    expect(await switchToOpenGroup(work)).toBe(true);

    expect((await activeIn(2))?.id).toBe(22);
    expect((await chrome.windows.getLastFocused()).id).toBe(2);
  });

  test('false, and nothing changes, when no group matches', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 10, url: C, active: true },
            { id: 11, url: A, groupId: 7 },
          ],
        },
      ],
      tabGroups: [{ id: 7, windowId: 1, title: 'Work', color: 'blue' }],
    });

    expect(await switchToOpenGroup(work)).toBe(false);
    expect((await activeIn(1))?.id).toBe(10);
  });

  test('false without the tab groups permission', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 10, url: C, active: true },
            { id: 11, url: A, groupId: 7 },
            { id: 12, url: B, groupId: 7 },
          ],
        },
      ],
      tabGroups: [{ id: 7, windowId: 1, title: 'Work', color: 'blue' }],
      tabGroupsApiAbsent: true,
    });

    expect(await switchToOpenGroup(work)).toBe(false);
    expect((await activeIn(1))?.id).toBe(10);
  });
});
