import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
  GroupMove,
  TabMove,
} from '../../../components/home/rightpane/rowDrag/dropRules';
import { toOpenWindows } from '../../../utils/functions/openNow';
import type { OpenWindow } from '../../../utils/functions/openNow';
import {
  moveOpenGroup,
  moveOpenTab,
} from '../../../utils/functions/openNowMoves';
import type {
  GroupLook,
  TabPlace,
} from '../../../utils/functions/openNowMoves';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

// A Tab Keeper page: Open now leaves it out, but Chrome's index counts it
// (ledger R4).
const TAB_KEEPER_PAGE = 'chrome-extension://faketestid/index.html';

// The snapshot is always read through toOpenWindows off the fake, never
// hand-built, so every shape here is one the real read produces.
async function snapshot(): Promise<OpenWindow[]> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

// A window's strip as Chrome has it: `P` pinned, `*` active, `gN` in group N.
const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map(
      (t) =>
        `${t.id}${t.pinned ? 'P' : ''}${t.active ? '*' : ''}${
          t.groupId === -1 ? '' : `g${t.groupId}`
        }`
    );

// The move a drop describes, with the string ids the drag engine carries.
const tabMove = (
  tabId: number,
  fromWindowId: number,
  toWindowId: number,
  toIndex: number,
  toGroupId?: number
): TabMove => ({
  tabId: String(tabId),
  fromWindowId: String(fromWindowId),
  toWindowId: String(toWindowId),
  toIndex,
  ...(toGroupId === undefined ? {} : { toGroupId: String(toGroupId) }),
});

const groupMove = (
  groupId: number,
  fromWindowId: number,
  toWindowId: number,
  toIndex: number
): GroupMove => ({
  groupId: String(groupId),
  fromWindowId: String(fromWindowId),
  toWindowId: String(toWindowId),
  toIndex,
});

const place = (
  windowId: number,
  index: number,
  groupId = -1,
  group: GroupLook | null = null
): TabPlace => ({ windowId, index, groupId, group });

describe('moveOpenTab: where a tab lands', () => {
  // W1 [11, 12, 13, 14], W2 [21, 22]
  const twoWindows = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [{ id: 11, active: true }, { id: 12 }, { id: 13 }, { id: 14 }],
        },
        { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
      ],
    });

  test('reorders a tab within its window: before the row now at toIndex', async () => {
    handle = twoWindows();

    const moved = await moveOpenTab(
      tabMove(11, 1, 1, 2),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['12', '13', '11*', '14']);
    expect(moved).toEqual([
      { tabId: 11, before: place(1, 0), after: place(1, 2) },
    ]);
  });

  test("reorders a tab to its window's end: after the last row", async () => {
    handle = twoWindows();

    const moved = await moveOpenTab(
      tabMove(12, 1, 1, 3),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['11*', '13', '14', '12']);
    expect(moved).toEqual([
      { tabId: 12, before: place(1, 1), after: place(1, 3) },
    ]);
  });

  test('moves a tab to another window, before the row at toIndex', async () => {
    handle = twoWindows();

    const moved = await moveOpenTab(
      tabMove(12, 1, 2, 1),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['11*', '13', '14']);
    expect(await strip(2)).toEqual(['21*', '12', '22']);
    expect(moved).toEqual([
      { tabId: 12, before: place(1, 1), after: place(2, 1) },
    ]);
  });

  test("moves a tab to another window's end", async () => {
    handle = twoWindows();

    const moved = await moveOpenTab(
      tabMove(12, 1, 2, 2),
      await snapshot(),
      false
    );

    expect(await strip(2)).toEqual(['21*', '22', '12']);
    expect(moved).toEqual([
      { tabId: 12, before: place(1, 1), after: place(2, 2) },
    ]);
  });

  describe('a hidden Tab Keeper page between rows (ledger R4)', () => {
    // W1 [11, 12=Tab Keeper, 13, 14]: rows 11, 13, 14.
    // W2 [21, 22=Tab Keeper, 23]: rows 21, 23.
    const withHiddenPages = () =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, url: TAB_KEEPER_PAGE },
              { id: 13 },
              { id: 14 },
            ],
          },
          {
            id: 2,
            tabs: [
              { id: 21, active: true },
              { id: 22, url: TAB_KEEPER_PAGE },
              { id: 23 },
            ],
          },
        ],
      });

    test('same window, leftward: lands right before the row, past the hidden page', async () => {
      handle = withHiddenPages();

      const moved = await moveOpenTab(
        tabMove(14, 1, 1, 1),
        await snapshot(),
        false
      );

      expect(await strip(1)).toEqual(['11*', '12', '14', '13']);
      expect(moved).toEqual([
        { tabId: 14, before: place(1, 3), after: place(1, 2) },
      ]);
    });

    test('same window, rightward to the end: counted with the tab removed', async () => {
      handle = withHiddenPages();

      const moved = await moveOpenTab(
        tabMove(11, 1, 1, 2),
        await snapshot(),
        false
      );

      expect(await strip(1)).toEqual(['12', '13', '14', '11*']);
      expect(moved).toEqual([
        { tabId: 11, before: place(1, 0), after: place(1, 3) },
      ]);
    });

    test('same window, rightward mid-window: lands right before the row', async () => {
      handle = withHiddenPages();

      // Rows without 11: [13, 14]; toIndex 1 is before 14.
      const moved = await moveOpenTab(
        tabMove(11, 1, 1, 1),
        await snapshot(),
        false
      );

      expect(await strip(1)).toEqual(['12', '13', '11*', '14']);
      expect(moved).toEqual([
        { tabId: 11, before: place(1, 0), after: place(1, 2) },
      ]);
    });

    test('dropped in place before the hidden page: no move call, the strip unchanged', async () => {
      handle = withHiddenPages();
      const moveSpy = vi.spyOn(chrome.tabs, 'move');

      const moved = await moveOpenTab(
        tabMove(11, 1, 1, 0),
        await snapshot(),
        false
      );

      expect(moveSpy).not.toHaveBeenCalled();
      expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
      expect(moved).toEqual([
        { tabId: 11, before: place(1, 0), after: place(1, 0) },
      ]);
    });

    test('across windows: the slot as it stands, past the hidden page', async () => {
      handle = withHiddenPages();

      const moved = await moveOpenTab(
        tabMove(13, 1, 2, 1),
        await snapshot(),
        false
      );

      expect(await strip(2)).toEqual(['21*', '22', '13', '23']);
      expect(moved).toEqual([
        { tabId: 13, before: place(1, 2), after: place(2, 2) },
      ]);
    });
  });
});

describe('moveOpenTab: what it refuses', () => {
  const oneWindow = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [{ id: 11, active: true }, { id: 12 }, { id: 13 }],
        },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
    });

  test.each([
    ['an unknown tab', tabMove(99, 1, 1, 0)],
    ['a tab id that is not a number', { ...tabMove(11, 1, 1, 0), tabId: 'x' }],
    ['an unknown destination window', tabMove(11, 1, 9, 0)],
    ['an unknown source window', tabMove(11, 9, 1, 0)],
    ['a source window the tab is not in', tabMove(11, 2, 1, 0)],
    ['a negative toIndex', tabMove(11, 1, 1, -1)],
    ['a toIndex past the end', tabMove(11, 1, 1, 3)],
    ['a fractional toIndex', tabMove(11, 1, 1, 0.5)],
  ])('%s: null, before any call', async (_name, move) => {
    handle = oneWindow();
    const moveSpy = vi.spyOn(chrome.tabs, 'move');
    const getSpy = vi.spyOn(chrome.tabs, 'get');

    const moved = await moveOpenTab(move, await snapshot(), false);

    expect(moved).toBeNull();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11*', '12', '13']);
  });

  test('a tab whose index changed since the snapshot: null, no move call', async () => {
    handle = oneWindow();
    const windows = await snapshot();
    await chrome.tabs.move(13, { index: 0 });
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    const moved = await moveOpenTab(tabMove(11, 1, 1, 2), windows, false);

    expect(moved).toBeNull();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['13', '11*', '12']);
  });

  test('a tab closed before the drop: null, no throw', async () => {
    handle = oneWindow();
    const windows = await snapshot();
    handle.browser.closeTab(12);

    const moved = await moveOpenTab(tabMove(12, 1, 1, 0), windows, false);

    expect(moved).toBeNull();
    expect(await strip(1)).toEqual(['11*', '13']);
  });
});

describe('moveOpenTab: pinned tabs and profiles (ledger R15)', () => {
  // W1 [11P*, 12P, 13], W2 [21*]; W3 incognito [31*].
  const pinnedAndIncognito = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, pinned: true, active: true },
            { id: 12, pinned: true },
            { id: 13 },
          ],
        },
        { id: 2, tabs: [{ id: 21, active: true }] },
        { id: 3, incognito: true, tabs: [{ id: 31, active: true }] },
      ],
    });

  test('K1: a pinned tab to another window is refused before any call (Chrome would unpin it)', async () => {
    handle = pinnedAndIncognito();
    const moveSpy = vi.spyOn(chrome.tabs, 'move');
    const getSpy = vi.spyOn(chrome.tabs, 'get');

    const moved = await moveOpenTab(
      tabMove(12, 1, 2, 0),
      await snapshot(),
      false
    );

    expect(moved).toBeNull();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11P*', '12P', '13']);
    expect(await strip(2)).toEqual(['21*']);
  });

  test('a pinned tab moved within its window stays pinned', async () => {
    handle = pinnedAndIncognito();

    const moved = await moveOpenTab(
      tabMove(12, 1, 1, 0),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['12P', '11P*', '13']);
    expect(moved).toEqual([
      { tabId: 12, before: place(1, 1), after: place(1, 0) },
    ]);
  });

  test.each([
    ['normal to incognito', tabMove(13, 1, 3, 0)],
    ['incognito to normal', tabMove(31, 3, 2, 0)],
  ])('O11d: %s is refused before any call', async (_name, move) => {
    handle = pinnedAndIncognito();
    const moveSpy = vi.spyOn(chrome.tabs, 'move');
    const getSpy = vi.spyOn(chrome.tabs, 'get');

    const moved = await moveOpenTab(move, await snapshot(), false);

    expect(moved).toBeNull();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11P*', '12P', '13']);
    expect(await strip(2)).toEqual(['21*']);
    expect(await strip(3)).toEqual(['31*']);
  });

  test('a tab pinned since the snapshot is refused across windows', async () => {
    handle = pinnedAndIncognito();
    const windows = await snapshot();
    await chrome.tabs.update(13, { pinned: true });
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    const moved = await moveOpenTab(tabMove(13, 1, 2, 0), windows, false);

    expect(moved).toBeNull();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(2)).toEqual(['21*']);
  });

  test('a tab moved to another window since the snapshot is refused', async () => {
    handle = pinnedAndIncognito();
    const windows = await snapshot();
    // At the same index there, so only the window says the snapshot is stale.
    handle.browser.openTab(2, {});
    handle.browser.moveTabToWindow(13, 2);
    expect((await chrome.tabs.get(13)).index).toBe(2);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    const moved = await moveOpenTab(tabMove(13, 1, 1, 2), windows, false);

    expect(moved).toBeNull();
    expect(moveSpy).not.toHaveBeenCalled();
  });
});

describe('moveOpenTab: groups, with the grant (ledger R16)', () => {
  const WORK: GroupLook = { title: 'Work', color: 'blue', collapsed: false };
  // W1 [11*, 12g5, 13g5, 14], group 5 "Work" blue; W2 [21*, 22].
  const withGroup = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, groupId: 5 },
            { id: 13, groupId: 5 },
            { id: 14 },
          ],
        },
        { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });

  describe('into a group, same window', () => {
    test("the run's head slot: Chrome doesn't join, so tabs.group does", async () => {
      handle = withGroup();

      const moved = await moveOpenTab(
        tabMove(14, 1, 1, 1, 5),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '14g5', '12g5', '13g5']);
      expect(moved).toEqual([
        { tabId: 14, before: place(1, 3), after: place(1, 1, 5, WORK) },
      ]);
    });

    test('the middle of the run: Chrome joins, nothing else is called', async () => {
      handle = withGroup();
      const groupSpy = vi.spyOn(chrome.tabs, 'group');

      const moved = await moveOpenTab(
        tabMove(14, 1, 1, 2, 5),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '13g5']);
      expect(groupSpy).not.toHaveBeenCalled();
      expect(moved).toEqual([
        { tabId: 14, before: place(1, 3), after: place(1, 2, 5, WORK) },
      ]);
    });

    test("the run's tail slot: Chrome doesn't join, so tabs.group does", async () => {
      handle = withGroup();

      // Rows without 11: [12, 13, 14]; toIndex 2 is before 14.
      const moved = await moveOpenTab(
        tabMove(11, 1, 1, 2, 5),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['12g5', '13g5', '11*g5', '14']);
      expect(moved).toEqual([
        { tabId: 11, before: place(1, 0), after: place(1, 2, 5, WORK) },
      ]);
    });
  });

  describe('into a group, across windows (Task 1 Q3: one tabs.move is refused)', () => {
    test("the run's head slot: tabs.group, then a move to the head", async () => {
      handle = withGroup();

      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 1, 5),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '22g5', '12g5', '13g5', '14']);
      expect(await strip(2)).toEqual(['21*']);
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 1, 5, WORK) },
      ]);
    });

    test('the middle of the run', async () => {
      handle = withGroup();

      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 2, 5),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '22g5', '13g5', '14']);
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 2, 5, WORK) },
      ]);
    });

    test("the run's tail slot: where tabs.group puts it, no second move", async () => {
      handle = withGroup();
      const moveSpy = vi.spyOn(chrome.tabs, 'move');

      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 3, 5),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22g5', '14']);
      expect(moveSpy).not.toHaveBeenCalled();
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 3, 5, WORK) },
      ]);
    });

    test('beside the run with no band named: lands loose', async () => {
      handle = withGroup();

      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 1),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '22', '12g5', '13g5', '14']);
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 1) },
      ]);
    });
  });

  describe('out of a group', () => {
    test('same window, cut off from the run: Chrome takes it out', async () => {
      handle = withGroup();
      const ungroupSpy = vi.spyOn(chrome.tabs, 'ungroup');

      // Rows without 12: [11, 13, 14]; toIndex 3 is the end.
      const moved = await moveOpenTab(
        tabMove(12, 1, 1, 3),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '13g5', '14', '12']);
      expect(ungroupSpy).not.toHaveBeenCalled();
      expect(moved).toEqual([
        { tabId: 12, before: place(1, 1, 5, WORK), after: place(1, 3) },
      ]);
    });

    test("same window, at the run's tail with no band named: tabs.ungroup", async () => {
      handle = withGroup();

      // Rows without 13: [11, 12, 14]; toIndex 2 is before 14 -- where 13
      // already is, so Chrome keeps it in the group.
      const moved = await moveOpenTab(
        tabMove(13, 1, 1, 2),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '13', '14']);
      expect(moved).toEqual([
        { tabId: 13, before: place(1, 2, 5, WORK), after: place(1, 2) },
      ]);
    });

    test('to another window', async () => {
      handle = withGroup();

      const moved = await moveOpenTab(
        tabMove(13, 1, 2, 2),
        await snapshot(),
        true
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '14']);
      expect(await strip(2)).toEqual(['21*', '22', '13']);
      expect(moved).toEqual([
        { tabId: 13, before: place(1, 2, 5, WORK), after: place(2, 2) },
      ]);
    });
  });

  describe('a lone tab dragged out of its group (settled A, spec O11f)', () => {
    const SOLO: GroupLook = { title: 'Solo', color: 'red', collapsed: true };
    // W1 [11*, 12g7, 13], group 7 "Solo" red collapsed; W2 [21*].
    const loneTab = () =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 7 },
              { id: 13 },
            ],
          },
          { id: 2, tabs: [{ id: 21, active: true }] },
        ],
        tabGroups: [
          { id: 7, windowId: 1, title: 'Solo', color: 'red', collapsed: true },
        ],
      });

    test('to another window: Chrome removes the group, and before.group keeps its look', async () => {
      handle = loneTab();

      const moved = await moveOpenTab(
        tabMove(12, 1, 2, 0),
        await snapshot(),
        true
      );

      expect(handle.groupState(7)).toBeUndefined();
      expect(await strip(2)).toEqual(['12', '21*']);
      expect(moved).toEqual([
        { tabId: 12, before: place(1, 1, 7, SOLO), after: place(2, 0) },
      ]);
    });

    test('within its window: ungrouped, and before.group keeps its look', async () => {
      handle = loneTab();

      const moved = await moveOpenTab(
        tabMove(12, 1, 1, 2),
        await snapshot(),
        true
      );

      expect(handle.groupState(7)).toBeUndefined();
      expect(await strip(1)).toEqual(['11*', '13', '12']);
      expect(moved).toEqual([
        { tabId: 12, before: place(1, 1, 7, SOLO), after: place(1, 2) },
      ]);
    });
  });

  test("a window's only row, out of its band in place: ungrouped where it is", async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 11, groupId: 7, active: true }] },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
      tabGroups: [{ id: 7, windowId: 1, title: 'Solo', color: 'red' }],
    });

    const moved = await moveOpenTab(
      tabMove(11, 1, 1, 0),
      await snapshot(),
      true
    );

    expect(await strip(1)).toEqual(['11*']);
    expect(moved).toEqual([
      {
        tabId: 11,
        before: place(1, 0, 7, {
          title: 'Solo',
          color: 'red',
          collapsed: false,
        }),
        after: place(1, 0),
      },
    ]);
  });

  describe('what it refuses', () => {
    test.each([
      ['a group the snapshot does not have', tabMove(14, 1, 1, 1, 9)],
      ['a group in another window', tabMove(21, 2, 2, 1, 5)],
    ])('%s: null, and nothing moves', async (_name, move) => {
      handle = withGroup();
      const moveSpy = vi.spyOn(chrome.tabs, 'move');
      const groupSpy = vi.spyOn(chrome.tabs, 'group');

      const moved = await moveOpenTab(move, await snapshot(), true);

      expect(moved).toBeNull();
      expect(moveSpy).not.toHaveBeenCalled();
      expect(groupSpy).not.toHaveBeenCalled();
    });

    test('a pinned tab named into a band: null before any call (a drag never pins or unpins, O11a)', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 10, pinned: true },
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
      });
      const moveSpy = vi.spyOn(chrome.tabs, 'move');
      const groupSpy = vi.spyOn(chrome.tabs, 'group');

      const moved = await moveOpenTab(
        tabMove(10, 1, 1, 0, 5),
        await snapshot(),
        true
      );

      expect(moved).toBeNull();
      expect(moveSpy).not.toHaveBeenCalled();
      expect(groupSpy).not.toHaveBeenCalled();
      expect(await strip(1)).toEqual(['10P', '11*', '12g5', '13g5']);
    });

    test('Chrome refuses a move into a run from another window: null, nothing moves', async () => {
      handle = withGroup();

      // No band named, but the slot is strictly inside the run.
      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 2),
        await snapshot(),
        true
      );

      expect(moved).toBeNull();
      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
      expect(await strip(2)).toEqual(['21*', '22']);
    });

    test('Chrome refuses the tabs.group after the move: null, the tab stays where Chrome put it', async () => {
      handle = withGroup();
      vi.spyOn(chrome.tabs, 'group').mockRejectedValue(
        new Error('No group with id: 5.')
      );

      const moved = await moveOpenTab(
        tabMove(14, 1, 1, 1, 5),
        await snapshot(),
        true
      );

      expect(moved).toBeNull();
      expect(await strip(1)).toEqual(['11*', '14', '12g5', '13g5']);
    });

    test('a group removed before the drop: null, the tab stays where Chrome put it', async () => {
      handle = withGroup();
      const windows = await snapshot();
      await chrome.tabs.ungroup([12, 13]);

      const moved = await moveOpenTab(tabMove(14, 1, 1, 1, 5), windows, true);

      expect(moved).toBeNull();
    });
  });
});

describe('moveOpenTab: without the grant, only tabs.move (E4)', () => {
  // W1 [11*, 12g5, 13g5, 14], W2 [21*, 22]; no grant.
  const ungranted = (tabGroupsApiAbsent: boolean) =>
    setupChromeFake({
      tabGroupsApiAbsent,
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, groupId: 5 },
            { id: 13, groupId: 5 },
            { id: 14 },
          ],
        },
        { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
      ],
    });

  test("beside a run: Chrome's own rule, no tabs.group or ungroup", async () => {
    handle = ungranted(true);
    const groupSpy = vi.spyOn(chrome.tabs, 'group');
    const ungroupSpy = vi.spyOn(chrome.tabs, 'ungroup');

    const moved = await moveOpenTab(
      tabMove(14, 1, 1, 1),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['11*', '14', '12g5', '13g5']);
    expect(groupSpy).not.toHaveBeenCalled();
    expect(ungroupSpy).not.toHaveBeenCalled();
    expect(moved).toEqual([
      { tabId: 14, before: place(1, 3), after: place(1, 1) },
    ]);
  });

  test("inside a run: Chrome's own join stands, no look", async () => {
    handle = ungranted(true);

    const moved = await moveOpenTab(
      tabMove(14, 1, 1, 2),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '13g5']);
    expect(moved).toEqual([
      { tabId: 14, before: place(1, 3), after: place(1, 2, 5, null) },
    ]);
  });

  test('a grouped tab: its real group id, and no look', async () => {
    handle = ungranted(true);

    // Rows without 13: [11, 12, 14]; toIndex 3 is the end.
    const moved = await moveOpenTab(
      tabMove(13, 1, 1, 3),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['11*', '12g5', '14', '13']);
    expect(moved).toEqual([
      { tabId: 13, before: place(1, 2, 5, null), after: place(1, 3) },
    ]);
  });

  test('a band named without the grant is ignored: no group call, no look read', async () => {
    handle = ungranted(false);
    const groupSpy = vi.spyOn(chrome.tabs, 'group');
    const getGroupSpy = vi.spyOn(chrome.tabGroups, 'get');

    const moved = await moveOpenTab(
      tabMove(12, 1, 1, 3, 5),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['11*', '13g5', '14', '12']);
    expect(groupSpy).not.toHaveBeenCalled();
    expect(getGroupSpy).not.toHaveBeenCalled();
    expect(moved).toEqual([
      { tabId: 12, before: place(1, 1, 5, null), after: place(1, 3) },
    ]);
  });
  test('a band named across windows without the grant is ignored: one tabs.move', async () => {
    handle = ungranted(false);
    const groupSpy = vi.spyOn(chrome.tabs, 'group');

    const moved = await moveOpenTab(
      tabMove(22, 2, 1, 3, 5),
      await snapshot(),
      false
    );

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22', '14']);
    expect(groupSpy).not.toHaveBeenCalled();
    expect(moved).toEqual([
      { tabId: 22, before: place(2, 1), after: place(1, 3) },
    ]);
  });

  // KAN-322 (spec O11e): without the grant the group's tabs draw as loose
  // rows, so the engine offers the slot between them. One tabs.move from
  // another window into a run is refused (Task 1 Q3), so the drop joins the
  // group with tabs.group, which works without the grant (Task 6a Q3), and
  // lands where the preview showed.
  describe('from another window, between two tabs of one Chrome group (KAN-322)', () => {
    test('joins that group, at the slot the preview showed', async () => {
      handle = ungranted(true);

      // W1's rows [11, 12, 13, 14]; toIndex 2 is between 12 and 13.
      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 2),
        await snapshot(),
        false
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '22g5', '13g5', '14']);
      expect(await strip(2)).toEqual(['21*']);
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 2, 5, null) },
      ]);
    });

    test('with the tabGroups API present but not granted, no tabGroups call', async () => {
      handle = ungranted(false);
      const calls = [
        vi.spyOn(chrome.tabGroups, 'get'),
        vi.spyOn(chrome.tabGroups, 'query'),
        vi.spyOn(chrome.tabGroups, 'update'),
        vi.spyOn(chrome.tabGroups, 'move'),
      ];
      const windows = await snapshot();
      for (const call of calls) call.mockClear();

      const moved = await moveOpenTab(tabMove(22, 2, 1, 2), windows, false);

      expect(await strip(1)).toEqual(['11*', '12g5', '22g5', '13g5', '14']);
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 2, 5, null) },
      ]);
      for (const call of calls) expect(call).not.toHaveBeenCalled();
    });

    test("a hidden Tab Keeper page as the group's first tab: before the first shown member joins too", async () => {
      // W1 [11*, 10=Tab Keeper g5, 12g5, 13g5, 14]: rows 11, 12, 13, 14.
      handle = setupChromeFake({
        tabGroupsApiAbsent: true,
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 10, url: TAB_KEEPER_PAGE, groupId: 5 },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
              { id: 14 },
            ],
          },
          { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
        ],
      });

      // toIndex 1 is before 12, which is Chrome's index 2: inside the run.
      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 1),
        await snapshot(),
        false
      );

      expect(await strip(1)).toEqual([
        '11*',
        '10g5',
        '22g5',
        '12g5',
        '13g5',
        '14',
      ]);
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 2, 5, null) },
      ]);
    });

    test('CONTROL: just past the run, one plain tabs.move and no group', async () => {
      handle = ungranted(true);
      const groupSpy = vi.spyOn(chrome.tabs, 'group');

      // toIndex 3 is before 14: the slot right after the run.
      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 3),
        await snapshot(),
        false
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22', '14']);
      expect(groupSpy).not.toHaveBeenCalled();
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 3) },
      ]);
    });

    test("CONTROL: at the run's head slot, one plain tabs.move and no group", async () => {
      handle = ungranted(true);
      const groupSpy = vi.spyOn(chrome.tabs, 'group');

      // toIndex 1 is before 12, the run's first tab: not inside the run.
      const moved = await moveOpenTab(
        tabMove(22, 2, 1, 1),
        await snapshot(),
        false
      );

      expect(await strip(1)).toEqual(['11*', '22', '12g5', '13g5', '14']);
      expect(groupSpy).not.toHaveBeenCalled();
      expect(moved).toEqual([
        { tabId: 22, before: place(2, 1), after: place(1, 1) },
      ]);
    });
  });
});

describe('moveOpenGroup', () => {
  const WORK: GroupLook = { title: 'Work', color: 'blue', collapsed: false };
  // W1 [11*, 12g5, 13g5, 14, 15], group 5 "Work" blue; W2 [21*, 22];
  // W3 incognito [31*].
  const withGroup = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, groupId: 5 },
            { id: 13, groupId: 5 },
            { id: 14 },
            { id: 15 },
          ],
        },
        { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
        { id: 3, incognito: true, tabs: [{ id: 31, active: true }] },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });

  describe('within its window: tabGroups.move', () => {
    test('rightward: before the row now at toIndex, counted with the group removed', async () => {
      handle = withGroup();

      // Rows without the group: [11, 14, 15]; toIndex 2 is before 15.
      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 2),
        await snapshot()
      );

      expect(await strip(1)).toEqual(['11*', '14', '12g5', '13g5', '15']);
      expect(moved).toEqual([
        {
          tabId: 12,
          before: place(1, 1, 5, WORK),
          after: place(1, 2, 5, WORK),
        },
        {
          tabId: 13,
          before: place(1, 2, 5, WORK),
          after: place(1, 3, 5, WORK),
        },
      ]);
    });

    test('to the front', async () => {
      handle = withGroup();

      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 0),
        await snapshot()
      );

      expect(await strip(1)).toEqual(['12g5', '13g5', '11*', '14', '15']);
      expect(moved?.map((tab) => [tab.tabId, tab.after.index])).toEqual([
        [12, 0],
        [13, 1],
      ]);
    });

    test('to the end: after the last row', async () => {
      handle = withGroup();

      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 3),
        await snapshot()
      );

      expect(await strip(1)).toEqual(['11*', '14', '15', '12g5', '13g5']);
      expect(moved?.map((tab) => [tab.tabId, tab.after.index])).toEqual([
        [12, 3],
        [13, 4],
      ]);
    });

    test("R13: a group holding the window's front tab still uses tabGroups.move (same id)", async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11 },
              { id: 12, groupId: 5, active: true },
              { id: 13, groupId: 5 },
              { id: 14 },
              { id: 15 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
      });

      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 2),
        await snapshot()
      );

      expect(await strip(1)).toEqual(['11', '14', '12*g5', '13g5', '15']);
      expect(moved?.map((tab) => tab.after)).toEqual([
        place(1, 2, 5, WORK),
        place(1, 3, 5, WORK),
      ]);
    });
  });

  describe('hidden Tab Keeper pages (ledger R4)', () => {
    test('between rows, same window: lands right before the row', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
              { id: 14, url: TAB_KEEPER_PAGE },
              { id: 15 },
              { id: 16 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
      });

      // Rows without the group: [11, 15, 16]; toIndex 2 is before 16.
      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 2),
        await snapshot()
      );

      expect(await strip(1)).toEqual(['11*', '14', '15', '12g5', '13g5', '16']);
      expect(moved?.map((tab) => [tab.tabId, tab.after.index])).toEqual([
        [12, 3],
        [13, 4],
      ]);
    });

    test('between rows, across windows: the slot as it stands', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
            ],
          },
          {
            id: 2,
            tabs: [
              { id: 21, active: true },
              { id: 22, url: TAB_KEEPER_PAGE },
              { id: 23 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
      });

      const moved = await moveOpenGroup(
        groupMove(5, 1, 2, 1),
        await snapshot()
      );

      expect(await strip(2)).toEqual(['21*', '22', '12g5', '13g5', '23']);
      expect(moved?.map((tab) => tab.after)).toEqual([
        place(2, 2, 5, WORK),
        place(2, 3, 5, WORK),
      ]);
    });

    test('dropped in place before the hidden page: no move call, the strip unchanged', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
              { id: 14, url: TAB_KEEPER_PAGE },
              { id: 15 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
      });
      const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');

      // Rows without the group: [11, 15]; toIndex 1 is where it was picked up.
      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 1),
        await snapshot()
      );

      expect(groupMoveSpy).not.toHaveBeenCalled();
      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
      expect(moved).toEqual([
        {
          tabId: 12,
          before: place(1, 1, 5, WORK),
          after: place(1, 1, 5, WORK),
        },
        {
          tabId: 13,
          before: place(1, 2, 5, WORK),
          after: place(1, 2, 5, WORK),
        },
      ]);
    });

    test('one inside the group moves with it, and is in the record', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5, url: TAB_KEEPER_PAGE },
              { id: 14 },
              { id: 15 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
      });

      // Rows without the group: [11, 14, 15]; toIndex 2 is before 15. The
      // group is TWO tabs in Chrome, though one row shows.
      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 2),
        await snapshot()
      );

      expect(await strip(1)).toEqual(['11*', '14', '12g5', '13g5', '15']);
      expect(moved?.map((tab) => [tab.tabId, tab.after.index])).toEqual([
        [12, 2],
        [13, 3],
      ]);
    });
  });

  test('to another window: tabGroups.move, the same id, the look kept', async () => {
    handle = withGroup();
    const groupSpy = vi.spyOn(chrome.tabs, 'group');

    const moved = await moveOpenGroup(groupMove(5, 1, 2, 1), await snapshot());

    expect(await strip(1)).toEqual(['11*', '14', '15']);
    expect(await strip(2)).toEqual(['21*', '12g5', '13g5', '22']);
    expect(groupSpy).not.toHaveBeenCalled();
    expect(moved).toEqual([
      { tabId: 12, before: place(1, 1, 5, WORK), after: place(2, 1, 5, WORK) },
      { tabId: 13, before: place(1, 2, 5, WORK), after: place(2, 2, 5, WORK) },
    ]);
  });

  describe("G1: a group holding its window's front tab, to another window (spec O11g)", () => {
    // W1 [11, 12g5*, 13g5, 14], group 5 "Gt" blue; W2 [21, 22*, 23].
    const g1Seed = (collapsed: boolean) =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11 },
              { id: 12, groupId: 5, active: true },
              { id: 13, groupId: 5 },
              { id: 14 },
            ],
          },
          {
            id: 2,
            tabs: [{ id: 21 }, { id: 22, active: true }, { id: 23 }],
          },
        ],
        tabGroups: [
          { id: 5, windowId: 1, title: 'Gt', color: 'blue', collapsed },
        ],
      });

    test.each([false, true])(
      "the destination's front tab stays; title, colour and collapsed kept; the new id in after (collapsed: %s)",
      async (collapsed) => {
        handle = g1Seed(collapsed);
        const look: GroupLook = { title: 'Gt', color: 'blue', collapsed };
        const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');

        const moved = await moveOpenGroup(
          groupMove(5, 1, 2, 1),
          await snapshot()
        );

        expect(groupMoveSpy).not.toHaveBeenCalled();
        const newId = moved?.[0]?.after.groupId;
        if (newId === undefined) throw new Error('no record');
        expect(newId).not.toBe(5);
        expect(handle.groupState(5)).toBeUndefined();
        expect(handle.groupState(newId)).toMatchObject({
          windowId: 2,
          title: 'Gt',
          color: 'blue',
          collapsed,
        });
        expect(await strip(2)).toEqual([
          '21',
          `12g${newId}`,
          `13g${newId}`,
          '22*',
          '23',
        ]);
        expect(moved).toEqual([
          {
            tabId: 12,
            before: place(1, 1, 5, look),
            after: place(2, 1, newId, look),
          },
          {
            tabId: 13,
            before: place(1, 2, 5, look),
            after: place(2, 2, newId, look),
          },
        ]);
      }
    );

    test('R17: a refused tabGroups.update returns null and leaves the tabs where Chrome has them', async () => {
      handle = g1Seed(false);
      vi.spyOn(chrome.tabGroups, 'update').mockRejectedValue(
        new Error('refused')
      );

      const moved = await moveOpenGroup(
        groupMove(5, 1, 2, 1),
        await snapshot()
      );

      expect(moved).toBeNull();
      const w2 = await strip(2);
      expect(w2.slice(1, 3).every((tab) => /^1[23]g\d+$/.test(tab))).toBe(true);
    });

    test('R17: a refused tabs.group returns null and leaves the tabs ungrouped in the destination', async () => {
      handle = g1Seed(false);
      vi.spyOn(chrome.tabs, 'group').mockRejectedValue(new Error('refused'));

      const moved = await moveOpenGroup(
        groupMove(5, 1, 2, 1),
        await snapshot()
      );

      expect(moved).toBeNull();
      expect(await strip(2)).toEqual(['21', '12', '13', '22*', '23']);
    });
  });

  test("a window's only row, dropped in place: no move, and a record", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, groupId: 5, active: true },
            { id: 12, groupId: 5 },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });

    const moved = await moveOpenGroup(groupMove(5, 1, 1, 0), await snapshot());

    expect(await strip(1)).toEqual(['11*g5', '12g5']);
    expect(moved).toEqual([
      { tabId: 11, before: place(1, 0, 5, WORK), after: place(1, 0, 5, WORK) },
      { tabId: 12, before: place(1, 1, 5, WORK), after: place(1, 1, 5, WORK) },
    ]);
  });

  describe('what it refuses', () => {
    test.each([
      ['an unknown group', groupMove(9, 1, 1, 0)],
      [
        'a group id that is not a number',
        { ...groupMove(5, 1, 1, 0), groupId: 'x' },
      ],
      ['an unknown destination window', groupMove(5, 1, 9, 0)],
      ['a source window the group is not in', groupMove(5, 2, 1, 0)],
      ['a negative toIndex', groupMove(5, 1, 1, -1)],
      ['a toIndex past the end', groupMove(5, 1, 1, 4)],
      ['O11d: normal to incognito', groupMove(5, 1, 3, 0)],
    ])('%s: null, before any call', async (_name, move) => {
      handle = withGroup();
      const querySpy = vi.spyOn(chrome.tabs, 'query');
      const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');
      const windows = await snapshot();

      const moved = await moveOpenGroup(move, windows);

      expect(moved).toBeNull();
      expect(querySpy).not.toHaveBeenCalled();
      expect(groupMoveSpy).not.toHaveBeenCalled();
      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
    });

    test('without the tabGroups API: null, before any call', async () => {
      handle = withGroup();
      const windows = await snapshot();
      handle.restore();
      handle = setupChromeFake({
        tabGroupsApiAbsent: true,
        windows: [{ id: 1, tabs: [{ id: 11 }, { id: 12, groupId: 5 }] }],
      });
      const querySpy = vi.spyOn(chrome.tabs, 'query');

      expect(await moveOpenGroup(groupMove(5, 1, 1, 0), windows)).toBeNull();
      expect(querySpy).not.toHaveBeenCalled();
    });

    test('a group whose index changed since the snapshot: null, no move call', async () => {
      handle = withGroup();
      const windows = await snapshot();
      await chrome.tabs.move(15, { index: 0 });
      const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');

      expect(await moveOpenGroup(groupMove(5, 1, 1, 0), windows)).toBeNull();
      expect(groupMoveSpy).not.toHaveBeenCalled();
      expect(await strip(1)).toEqual(['15', '11*', '12g5', '13g5', '14']);
    });

    test('a group that lost a listed tab since the snapshot: null, no move call', async () => {
      handle = withGroup();
      const windows = await snapshot();
      handle.browser.closeTab(13);
      const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');

      expect(await moveOpenGroup(groupMove(5, 1, 1, 0), windows)).toBeNull();
      expect(groupMoveSpy).not.toHaveBeenCalled();
    });

    test('a group whose tabs all closed before the drop: null', async () => {
      handle = withGroup();
      const windows = await snapshot();
      handle.browser.closeTab(12);
      handle.browser.closeTab(13);

      expect(await moveOpenGroup(groupMove(5, 1, 1, 2), windows)).toBeNull();
    });

    // Task 6c fix round 1: a slot in the pinned run is no longer passed to
    // Chrome (it lands just below the run), so Chrome's own refusal is
    // staged directly.
    test('within its window, a slot in the pinned run lands just below it', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 10, pinned: true },
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
      });

      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 0),
        await snapshot()
      );

      expect(moved).not.toBeNull();
      expect(await strip(1)).toEqual(['10P', '12g5', '13g5', '11*']);
    });

    test('Chrome refuses tabGroups.move: null, nothing moves', async () => {
      handle = withGroup();
      vi.spyOn(chrome.tabGroups, 'move').mockRejectedValue(
        new Error(
          'Cannot move the group to an index that is in the middle of pinned tabs.'
        )
      );

      const moved = await moveOpenGroup(
        groupMove(5, 1, 1, 3),
        await snapshot()
      );

      expect(moved).toBeNull();
      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
    });
  });
});

// Task 6c fix round 1 (review Important 1, spec O11c). The engine commits
// index 0 for a FOLDED window, which draws no rows, and the snapshot leaves
// out hidden Tab Keeper pages, so a visible index can name a slot inside the
// pinned run as Chrome has it. An unpinned tab or a group is placed no
// earlier than the end of that run, read from Chrome at drop time -- the
// slot the preview drew under the pinned line.
describe('an unpinned tab or a group lands below the pinned run as Chrome has it', () => {
  // W1 [11*, 12g5, 13g5, 14], group 5 "Work"; W2 [21P, 22P, 23*, 24];
  // W3 [31P*, 32P], every tab pinned; W4 [41P*, 42P=Tab Keeper], whose
  // visible tabs are all pinned and whose pinned run ends at a hidden page.
  const pinnedWindows = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, groupId: 5 },
            { id: 13, groupId: 5 },
            { id: 14 },
          ],
        },
        {
          id: 2,
          tabs: [
            { id: 21, pinned: true },
            { id: 22, pinned: true },
            { id: 23, active: true },
            { id: 24 },
          ],
        },
        {
          id: 3,
          tabs: [
            { id: 31, pinned: true, active: true },
            { id: 32, pinned: true },
          ],
        },
        {
          id: 4,
          tabs: [
            { id: 41, pinned: true, active: true },
            { id: 42, pinned: true, url: TAB_KEEPER_PAGE },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });

  test('a group dropped at 0 on a folded window with pinned tabs: the first unpinned index', async () => {
    handle = pinnedWindows();
    const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');

    const moved = await moveOpenGroup(groupMove(5, 1, 2, 0), await snapshot());

    expect(moved).not.toBeNull();
    expect(groupMoveSpy).toHaveBeenCalledWith(5, { windowId: 2, index: 2 });
    expect(await strip(2)).toEqual(['21P', '22P', '12g5', '13g5', '23*', '24']);
  });

  test('an unpinned tab dropped at 0 on a folded window with pinned tabs: asked for the first unpinned index', async () => {
    handle = pinnedWindows();
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    const moved = await moveOpenTab(
      tabMove(14, 1, 2, 0),
      await snapshot(),
      true
    );

    expect(moved).not.toBeNull();
    expect(moveSpy).toHaveBeenCalledWith(14, { windowId: 2, index: 2 });
    expect(await strip(2)).toEqual(['21P', '22P', '14', '23*', '24']);
  });

  test.each([
    ['a window whose tabs are all pinned, folded (toIndex 0)', 3, 0, '31P*'],
    // Unfolded: landingRange puts the drop at the end of the VISIBLE pinned
    // tabs, which is the hidden page's own slot.
    ['a hidden pinned Tab Keeper page ending the run', 4, 1, '41P*'],
  ])(
    '%s: a group lands at the end of the run',
    async (_name, to, at, first) => {
      handle = pinnedWindows();
      const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');

      const moved = await moveOpenGroup(
        groupMove(5, 1, to, at),
        await snapshot()
      );

      expect(moved).not.toBeNull();
      expect(groupMoveSpy).toHaveBeenCalledWith(5, { windowId: to, index: 2 });
      expect((await strip(to)).slice(0, 1)).toEqual([first]);
      expect((await strip(to)).slice(2)).toEqual(['12g5', '13g5']);
    }
  );

  test.each([
    ['a window whose tabs are all pinned, folded (toIndex 0)', 3, 0],
    ['a hidden pinned Tab Keeper page ending the run', 4, 1],
  ])('%s: a tab is asked for the end of the run', async (_name, to, at) => {
    handle = pinnedWindows();
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    const moved = await moveOpenTab(
      tabMove(14, 1, to, at),
      await snapshot(),
      true
    );

    expect(moved).not.toBeNull();
    expect(moveSpy).toHaveBeenCalledWith(14, { windowId: to, index: 2 });
    expect((await strip(to))[2]).toBe('14');
  });

  // CONTROL, unchanged by the floor: a hidden pinned page before the rows
  // is already passed, because the slot is the next visible row's own.
  test('CONTROL: within its window, past a hidden pinned page at the front', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, pinned: true, url: TAB_KEEPER_PAGE },
            { id: 11, active: true },
            { id: 12 },
          ],
        },
      ],
    });
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(
      await moveOpenTab(tabMove(12, 1, 1, 0), await snapshot(), false)
    ).not.toBeNull();
    expect(moveSpy).toHaveBeenCalledWith(12, { index: 1 });
    expect(await strip(1)).toEqual(['10P', '12', '11*']);
  });

  test('CONTROL: a pinned tab keeps its place in the run: no floor for it', async () => {
    handle = pinnedWindows();
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(
      await moveOpenTab(tabMove(22, 2, 2, 0), await snapshot(), true)
    ).not.toBeNull();
    expect(moveSpy).toHaveBeenCalledWith(22, { index: 0 });
    expect(await strip(2)).toEqual(['22P', '21P', '23*', '24']);
  });
});
