import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
  GroupMove,
  TabMove,
} from '../../../components/home/rightpane/rowDrag/dropRules';
import { toOpenWindows } from '../../../utils/functions/openNow';
import type { OpenWindow } from '../../../utils/functions/openNow';
import {
  changedAnyPlace,
  moveOpenGroup,
  moveOpenTab,
  undoOpenNowDrop,
} from '../../../utils/functions/openNowMoves';
import type {
  MovedTabs,
  OpenNowDrop,
  TabPlace,
} from '../../../utils/functions/openNowMoves';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-280 Part E Task 7 (spec O11f, U1): ⌘Z puts an Open now drop back.
// Every record here is one moveOpenTab / moveOpenGroup really produced
// against the fake, never hand-built, so the undo is tested against the
// shape a drop leaves.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

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

// A drop the fake carried out, as ⌘Z would find it. Throws when the drop
// was refused: every test here starts from a drop that happened.
async function dropTab(
  move: TabMove,
  hasTabGroups: boolean
): Promise<OpenNowDrop> {
  const moved = await moveOpenTab(move, await snapshot(), hasTabGroups);
  if (moved === null) throw new Error('PREMISE: the drop was refused');
  return { kind: 'tab', moved };
}

async function dropGroup(move: GroupMove): Promise<OpenNowDrop> {
  const moved = await moveOpenGroup(move, await snapshot());
  if (moved === null) throw new Error('PREMISE: the drop was refused');
  return { kind: 'group', moved };
}

// A tab's group id as Chrome has it now (-1: none).
async function groupOf(tabId: number): Promise<number> {
  return (await chrome.tabs.get(tabId)).groupId;
}

// W1 [11*, 12, 13, 14], W2 [21*, 22]
const plain: ChromeSeed = {
  windows: [
    {
      id: 1,
      tabs: [{ id: 11, active: true }, { id: 12 }, { id: 13 }, { id: 14 }],
    },
    { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
  ],
};

// W1 [11*, 12g5, 13g5, 14], group 5 "Work" blue; W2 [21*, 22].
const grouped = (tabGroupsApiAbsent = false): ChromeSeed => ({
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
  tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
});

describe('undoOpenNowDrop: a tab goes back', () => {
  test('within its window', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(11, 1, 1, 2), false);
    // PREMISE: the drop moved it.
    expect(await strip(1)).toEqual(['12', '13', '11*', '14']);

    expect(await undoOpenNowDrop(drop, false)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
  });

  test('from another window, to its old window and index', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(12, 1, 2, 1), false);
    expect(await strip(2)).toEqual(['21*', '12', '22']);

    expect(await undoOpenNowDrop(drop, false)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
    expect(await strip(2)).toEqual(['21*', '22']);
  });

  test('rightward within its window: counted with the tab removed', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(14, 1, 1, 0), false);
    expect(await strip(1)).toEqual(['14', '11*', '12', '13']);

    expect(await undoOpenNowDrop(drop, false)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
  });
});

describe('undoOpenNowDrop: the group a tab had', () => {
  test('dragged out of a group within its window: back in it', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(12, 1, 1, 3), true);
    expect(await strip(1)).toEqual(['11*', '13g5', '14', '12']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('dragged out of a group to another window: back in it, at its old index', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(12, 1, 2, 0), true);
    expect(await strip(1)).toEqual(['11*', '13g5', '14']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
    expect(await strip(2)).toEqual(['21*', '22']);
  });

  test("dragged out of a group's middle to another window: back in the middle (one tabs.move there is refused, Task 1 Q3)", async () => {
    // W1 [11*, 12g5, 13g5, 14g5, 15]; W2 [21*].
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, groupId: 5 },
            { id: 13, groupId: 5 },
            { id: 14, groupId: 5 },
            { id: 15 },
          ],
        },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });
    const drop = await dropTab(tabMove(13, 1, 2, 0), true);
    expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '15']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14g5', '15']);
    expect(await strip(2)).toEqual(['21*']);
  });

  test('dragged into a group: back out of it', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(14, 1, 1, 1, 5), true);
    expect(await strip(1)).toEqual(['11*', '14g5', '12g5', '13g5']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('dragged from another window into a group: back to its window, ungrouped', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(22, 2, 1, 2, 5), true);
    expect(await strip(1)).toEqual(['11*', '12g5', '22g5', '13g5', '14']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
    expect(await strip(2)).toEqual(['21*', '22']);
  });

  test('joined a group in place (the index unchanged): ungrouped in place', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(14, 1, 1, 3, 5), true);
    // PREMISE: only its group changed.
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14g5']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test("with the grant, the group's collapsed state is put back", async () => {
    // W1 [11, 12g5*, 13g5, 14], group 5 collapsed and holding the front tab.
    handle = setupChromeFake({
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
      ],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Work', color: 'blue', collapsed: true },
      ],
    });
    const drop = await dropTab(tabMove(12, 1, 1, 3), true);
    handle.browser.setGroup(5, { collapsed: false });
    // PREMISE: the group is expanded now.
    expect(handle.groupState(5)?.collapsed).toBe(false);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11', '12*g5', '13g5', '14']);
    expect(handle.groupState(5)?.collapsed).toBe(true);
  });
});

describe('undoOpenNowDrop: a lone tab whose group Chrome removed (settled A)', () => {
  // W3 [11*, 12g7, 13], group 7 "Solo" red collapsed; W4 [21*]. Not
  // windows 1 and 2: a group made with no window named lands in the CURRENT
  // window (Task 6a Q3), which the fake doesn't model -- it records window
  // 1 -- so only a home window other than 1 shows the window was named.
  const loneTab = (tabGroupsApiAbsent = false): ChromeSeed => ({
    tabGroupsApiAbsent,
    windows: [
      {
        id: 3,
        tabs: [{ id: 11, active: true }, { id: 12, groupId: 7 }, { id: 13 }],
      },
      { id: 4, focused: true, tabs: [{ id: 21, active: true }] },
    ],
    tabGroups: [
      { id: 7, windowId: 3, title: 'Solo', color: 'red', collapsed: true },
    ],
  });

  test.each([
    ['from another window', tabMove(12, 3, 4, 0)],
    ['within its window', tabMove(12, 3, 3, 2)],
  ])(
    '%s, with the grant: a new group in the same place, with the old title, colour and collapsed',
    async (_name, move) => {
      handle = setupChromeFake(loneTab());
      const drop = await dropTab(move, true);
      // PREMISE: Chrome removed the group.
      expect(handle.groupState(7)).toBeUndefined();

      expect(await undoOpenNowDrop(drop, true)).toBe('undone');

      const rebuilt = await groupOf(12);
      expect(rebuilt).not.toBe(-1);
      expect(rebuilt).not.toBe(7);
      expect(await strip(3)).toEqual(['11*', `12g${rebuilt}`, '13']);
      expect(handle.groupState(rebuilt)).toMatchObject({
        windowId: 3,
        title: 'Solo',
        color: 'red',
        collapsed: true,
      });
    }
  );

  test('without the grant: back in its place, ungrouped', async () => {
    handle = setupChromeFake(loneTab(true));
    const groupSpy = vi.spyOn(chrome.tabs, 'group');
    const drop = await dropTab(tabMove(12, 3, 4, 0), false);
    // PREMISE: the record knows the group id but has no look.
    expect(drop.moved[0]?.before).toEqual({
      windowId: 3,
      index: 1,
      groupId: 7,
      group: null,
    });

    expect(await undoOpenNowDrop(drop, false)).toBe('undone');

    expect(await strip(3)).toEqual(['11*', '12', '13']);
    expect(groupSpy).not.toHaveBeenCalled();
  });

  test('a drop made without the grant, undone with it: still ungrouped (no look to rebuild with)', async () => {
    handle = setupChromeFake(loneTab());
    const drop = await dropTab(tabMove(12, 3, 4, 0), false);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(3)).toEqual(['11*', '12', '13']);
  });
});

describe('undoOpenNowDrop: without the grant (spec O11e, E4)', () => {
  test('a tab Chrome took out of an invisible group goes back into it', async () => {
    handle = setupChromeFake(grouped(true));
    const drop = await dropTab(tabMove(12, 1, 1, 3), false);
    // PREMISE: Chrome took it out (Task 1 Q3), and nothing put it back.
    expect(await strip(1)).toEqual(['11*', '13g5', '14', '12']);

    expect(await undoOpenNowDrop(drop, false)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('a tab Chrome joined into an invisible group goes back to its index, ungrouped (Review Focus 5)', async () => {
    handle = setupChromeFake(grouped(true));
    const drop = await dropTab(tabMove(14, 1, 1, 2), false);
    // PREMISE: Chrome joined it (Part D M2).
    expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '13g5']);

    expect(await undoOpenNowDrop(drop, false)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });
});

describe('undoOpenNowDrop: a group goes back', () => {
  // W1 [11*, 12g5, 13g5, 14, 15], group 5 "Work" blue; W2 [21*, 22].
  const withGroup = (collapsed = false): ChromeSeed => ({
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
    ],
    tabGroups: [
      { id: 5, windowId: 1, title: 'Work', color: 'blue', collapsed },
    ],
  });

  test('within its window: tabGroups.move, the same id', async () => {
    handle = setupChromeFake(withGroup());
    const drop = await dropGroup(groupMove(5, 1, 1, 3));
    expect(await strip(1)).toEqual(['11*', '14', '15', '12g5', '13g5']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
  });

  test('from another window: tabGroups.move, the same id', async () => {
    handle = setupChromeFake(withGroup());
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    expect(await strip(2)).toEqual(['21*', '12g5', '13g5', '22']);

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
    expect(await strip(2)).toEqual(['21*', '22']);
  });

  test('its collapsed state is put back', async () => {
    handle = setupChromeFake(withGroup(true));
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    handle.browser.setGroup(5, { collapsed: false });

    expect(await undoOpenNowDrop(drop, true)).toBe('undone');

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
    expect(handle.groupState(5)?.collapsed).toBe(true);
  });

  describe('G1 (spec O11g, ledger R24)', () => {
    // W1 [11, 12g5*, 13g5, 14], group 5 "Gt" blue; W2 [21, 22*, 23].
    const g1Seed: ChromeSeed = {
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
        { id: 2, tabs: [{ id: 21 }, { id: 22, active: true }, { id: 23 }] },
      ],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Gt', color: 'blue', collapsed: true },
      ],
    };

    test('a G1 drop undone: the new group goes back, with its look', async () => {
      handle = setupChromeFake(g1Seed);
      const drop = await dropGroup(groupMove(5, 1, 2, 1));
      const newId = drop.moved[0]?.after.groupId;
      if (newId === undefined) throw new Error('no record');

      expect(await undoOpenNowDrop(drop, true)).toBe('undone');

      expect(await strip(1)).toEqual([
        '11',
        `12g${newId}`,
        `13g${newId}`,
        '14*',
      ]);
      expect(await strip(2)).toEqual(['21', '22*', '23']);
      expect(handle.groupState(newId)).toMatchObject({
        windowId: 1,
        title: 'Gt',
        color: 'blue',
        collapsed: true,
      });
    });

    test("a group holding its window's front tab at undo time goes back by tabs.move + tabs.group, so the old window's front tab stays", async () => {
      // The drop itself holds no front tab: 13 is not active. The group is
      // moved with tabGroups.move, and the user then switches to 12 in W2.
      handle = setupChromeFake({
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
        tabGroups: [
          { id: 5, windowId: 1, title: 'Gt', color: 'blue', collapsed: false },
        ],
      });
      const drop = await dropGroup(groupMove(5, 1, 2, 1));
      handle.browser.activateTab(12);
      expect(await strip(2)).toEqual(['21', '12*g5', '13g5', '22']);
      const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');

      expect(await undoOpenNowDrop(drop, true)).toBe('undone');

      expect(groupMoveSpy).not.toHaveBeenCalled();
      const regrouped = await groupOf(12);
      expect(await strip(1)).toEqual([
        '11*',
        `12g${regrouped}`,
        `13g${regrouped}`,
        '14',
      ]);
      expect(handle.groupState(regrouped)).toMatchObject({
        windowId: 1,
        title: 'Gt',
        color: 'blue',
        collapsed: false,
      });
    });

    test('CONTROL: the same undo with no front tab in the group keeps its id (tabGroups.move)', async () => {
      handle = setupChromeFake({
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
        tabGroups: [{ id: 5, windowId: 1, title: 'Gt', color: 'blue' }],
      });
      const drop = await dropGroup(groupMove(5, 1, 2, 1));

      expect(await undoOpenNowDrop(drop, true)).toBe('undone');

      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
    });
  });
});

describe('undoOpenNowDrop: stale (Review Focus 3)', () => {
  test('a tab moved by hand since the drop: nothing moves', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(12, 1, 2, 1), false);
    handle.browser.moveTabToWindow(12, 1);
    const before1 = await strip(1);
    const before2 = await strip(2);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await undoOpenNowDrop(drop, false)).toBe('stale');

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(before1);
    expect(await strip(2)).toEqual(before2);
  });

  test('a tab closed since the drop: nothing moves, no throw', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(12, 1, 2, 1), false);
    handle.browser.closeTab(12);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await undoOpenNowDrop(drop, false)).toBe('stale');

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11*', '13', '14']);
    expect(await strip(2)).toEqual(['21*', '22']);
  });

  test('a tab whose index changed (a tab before it closed): nothing moves', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(11, 1, 1, 2), false);
    handle.browser.closeTab(12);
    // PREMISE: 11 is still in its window, one slot left of where it landed.
    expect(await strip(1)).toEqual(['13', '11*', '14']);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await undoOpenNowDrop(drop, false)).toBe('stale');

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['13', '11*', '14']);
  });

  test("one of a group's tabs closed since the drop: nothing moves", async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    handle.browser.closeTab(13);
    const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await undoOpenNowDrop(drop, true)).toBe('stale');

    expect(groupMoveSpy).not.toHaveBeenCalled();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(2)).toEqual(['21*', '12g5', '22']);
  });
});

describe('undoOpenNowDrop: Chrome refuses part way (no throw; the list re-reads)', () => {
  test('the rejoin refused: the tab is back at its index, ungrouped', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(12, 1, 1, 3), true);
    vi.spyOn(chrome.tabs, 'group').mockRejectedValue(new Error('refused'));

    expect(await undoOpenNowDrop(drop, true)).toBe('refused');

    expect(await strip(1)).toEqual(['11*', '12', '13g5', '14']);
  });

  test("its old window closed (it was that window's only tab): refused, the tab stays", async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 11, active: true }] },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
    });
    const drop = await dropTab(tabMove(11, 1, 2, 1), false);
    // PREMISE: Chrome closed the window (Task 6a Q4).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      (await chrome.windows.getAll({})).map((window) => window.id)
    ).toEqual([2]);

    expect(await undoOpenNowDrop(drop, false)).toBe('refused');

    expect(await strip(2)).toEqual(['21*', '11']);
  });

  test('G1 undo, the regroup refused: the tabs are back in their window, ungrouped', async () => {
    handle = setupChromeFake({
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
      tabGroups: [{ id: 5, windowId: 1, title: 'Gt', color: 'blue' }],
    });
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    handle.browser.activateTab(12);
    vi.spyOn(chrome.tabs, 'group').mockRejectedValue(new Error('refused'));

    expect(await undoOpenNowDrop(drop, true)).toBe('refused');

    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
  });
});

describe('changedAnyPlace (ledger R23)', () => {
  const at = (windowId: number, index: number, groupId = -1): TabPlace => ({
    windowId,
    index,
    groupId,
    group: null,
  });
  const record = (before: TabPlace, after: TabPlace): MovedTabs => [
    { tabId: 1, before, after },
  ];

  test.each([
    ['a window', record(at(1, 0), at(2, 0)), true],
    ['an index', record(at(1, 0), at(1, 1)), true],
    ['a group only (the index unchanged)', record(at(1, 0), at(1, 0, 5)), true],
    ['nothing: a drop in place', record(at(1, 0, 5), at(1, 0, 5)), false],
  ])('%s changed: %s', (_name, moved, expected) => {
    expect(changedAnyPlace(moved)).toBe(expected);
  });

  test('a group record changes something when any one tab does', () => {
    expect(
      changedAnyPlace([
        { tabId: 1, before: at(1, 0), after: at(1, 0) },
        { tabId: 2, before: at(1, 1), after: at(1, 2) },
      ])
    ).toBe(true);
  });
});
