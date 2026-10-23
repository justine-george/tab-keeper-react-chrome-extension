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
  runLiveStep,
} from '../../../utils/functions/openNowMoves';
import type {
  LiveRun,
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

// The record a run hands on for the next press. Throws unless it was done:
// every redo here starts from an undo that happened.
async function ran(run: Promise<LiveRun>): Promise<OpenNowDrop> {
  const result = await run;
  if (result.outcome !== 'done') {
    throw new Error(`PREMISE: the run was ${result.outcome}`);
  }
  return result.drop;
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

describe('runLiveStep, undo: a tab goes back', () => {
  test('within its window', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(11, 1, 1, 2), false);
    // PREMISE: the drop moved it.
    expect(await strip(1)).toEqual(['12', '13', '11*', '14']);

    expect(await runLiveStep(drop, 'undo', false)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
  });
});

describe('runLiveStep, undo: the group a tab had', () => {
  test('dragged out of a group within its window: back in it', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(12, 1, 1, 3), true);
    expect(await strip(1)).toEqual(['11*', '13g5', '14', '12']);

    expect(await runLiveStep(drop, 'undo', true)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('dragged out of a group to another window: back in it, at its old index', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(12, 1, 2, 0), true);
    expect(await strip(1)).toEqual(['11*', '13g5', '14']);

    await runLiveStep(drop, 'undo', true);

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

    await runLiveStep(drop, 'undo', true);

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14g5', '15']);
    expect(await strip(2)).toEqual(['21*']);
  });

  test('dragged into a group: back out of it', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(14, 1, 1, 1, 5), true);
    expect(await strip(1)).toEqual(['11*', '14g5', '12g5', '13g5']);

    await runLiveStep(drop, 'undo', true);

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('dragged from another window into a group: back to its window, ungrouped', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(22, 2, 1, 2, 5), true);
    expect(await strip(1)).toEqual(['11*', '12g5', '22g5', '13g5', '14']);

    await runLiveStep(drop, 'undo', true);

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
    expect(await strip(2)).toEqual(['21*', '22']);
  });

  test('joined a group in place (the index unchanged): ungrouped in place', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(14, 1, 1, 3, 5), true);
    // PREMISE: only its group changed.
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14g5']);

    await runLiveStep(drop, 'undo', true);

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

    await runLiveStep(drop, 'undo', true);

    expect(await strip(1)).toEqual(['11', '12*g5', '13g5', '14']);
    expect(handle.groupState(5)?.collapsed).toBe(true);
  });
});

describe('runLiveStep, undo: a lone tab whose group Chrome removed (settled A)', () => {
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

      expect(await runLiveStep(drop, 'undo', true)).toMatchObject({
        outcome: 'done',
      });

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

    await runLiveStep(drop, 'undo', false);

    expect(await strip(3)).toEqual(['11*', '12', '13']);
    expect(groupSpy).not.toHaveBeenCalled();
  });

  test('a drop made without the grant, undone with it: still ungrouped (no look to rebuild with)', async () => {
    handle = setupChromeFake(loneTab());
    const drop = await dropTab(tabMove(12, 3, 4, 0), false);

    await runLiveStep(drop, 'undo', true);

    expect(await strip(3)).toEqual(['11*', '12', '13']);
  });
});

describe('runLiveStep, undo: without the grant (spec O11e, E4)', () => {
  test('a tab Chrome took out of an invisible group goes back into it', async () => {
    handle = setupChromeFake(grouped(true));
    const drop = await dropTab(tabMove(12, 1, 1, 3), false);
    // PREMISE: Chrome took it out (Task 1 Q3), and nothing put it back.
    expect(await strip(1)).toEqual(['11*', '13g5', '14', '12']);

    expect(await runLiveStep(drop, 'undo', false)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('a tab Chrome joined into an invisible group goes back to its index, ungrouped (Review Focus 5)', async () => {
    handle = setupChromeFake(grouped(true));
    const drop = await dropTab(tabMove(14, 1, 1, 2), false);
    // PREMISE: Chrome joined it (Part D M2).
    expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '13g5']);

    await runLiveStep(drop, 'undo', false);

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('a tab from another window that joined an invisible group (KAN-322) goes back to its window, ungrouped', async () => {
    handle = setupChromeFake(grouped(true));
    const drop = await dropTab(tabMove(22, 2, 1, 2), false);
    // PREMISE: it joined group 5 between 12 and 13, and the record says so.
    expect(await strip(1)).toEqual(['11*', '12g5', '22g5', '13g5', '14']);
    expect(drop.moved.map(({ after }) => after.groupId)).toEqual([5]);

    await runLiveStep(drop, 'undo', false);

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
    expect(await strip(2)).toEqual(['21*', '22']);
  });
});

describe('runLiveStep, undo: a group goes back', () => {
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

    expect(await runLiveStep(drop, 'undo', true)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
  });

  test('its collapsed state is put back', async () => {
    handle = setupChromeFake(withGroup(true));
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    handle.browser.setGroup(5, { collapsed: false });

    await runLiveStep(drop, 'undo', true);

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

      await runLiveStep(drop, 'undo', true);

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

      await runLiveStep(drop, 'undo', true);

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
  });
});

describe('runLiveStep, undo: stale (Review Focus 3)', () => {
  test('a tab closed since the drop: nothing moves, no throw', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(12, 1, 2, 1), false);
    handle.browser.closeTab(12);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'changedSince',
    });

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

    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'changedSince',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['13', '11*', '14']);
  });

  // KAN-323: a place is window, index AND group. A tab regrouped by hand
  // where the drop left it is not where the drop left it.
  test('a tab regrouped by hand in place since the drop: nothing moves, and the new group survives', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(14, 1, 1, 3, 5), true);
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14g5']);
    // By hand: 14 into a new group "Mine", where it stands.
    const mine = await chrome.tabs.group({
      tabIds: [14],
      createProperties: { windowId: 1 },
    });
    await chrome.tabGroups.update(mine, { title: 'Mine' });
    // PREMISE: only its group changed; its window and index did not.
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', `14g${mine}`]);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');
    const ungroupSpy = vi.spyOn(chrome.tabs, 'ungroup');

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'changedSince',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(ungroupSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', `14g${mine}`]);
    expect((await chrome.tabGroups.get(mine)).title).toBe('Mine');
  });

  test('without the grant, a tab grouped by hand in place since the drop: nothing moves', async () => {
    handle = setupChromeFake(grouped(true));
    // Just past group 5's run: loose.
    const drop = await dropTab(tabMove(22, 2, 1, 3), false);
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22', '14']);
    // By hand: 22 joins group 5 where it stands (it is beside the run).
    await chrome.tabs.group({ groupId: 5, tabIds: [22] });
    // PREMISE: only its group changed.
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22g5', '14']);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'changedSince',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22g5', '14']);
    expect(await strip(2)).toEqual(['21*']);
  });

  test("one of a group's tabs closed since the drop: nothing moves", async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    handle.browser.closeTab(13);
    const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'changedSince',
    });

    expect(groupMoveSpy).not.toHaveBeenCalled();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(2)).toEqual(['21*', '12g5', '22']);
  });
});

describe('runLiveStep, undo: Chrome refuses part way (no throw; the list re-reads)', () => {
  test('the rejoin refused: the tab is back at its index, ungrouped', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(12, 1, 1, 3), true);
    vi.spyOn(chrome.tabs, 'group').mockRejectedValue(new Error('refused'));

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'couldNotRun',
    });

    expect(await strip(1)).toEqual(['11*', '12', '13g5', '14']);
  });

  test("its old window closed (it was that window's only tab): windowClosed, nothing moves", async () => {
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
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    // KAN-744: a closed target window is its own outcome.
    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'windowClosed',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(2)).toEqual(['21*', '11']);
  });

  test('a group whose old window closed: windowClosed, nothing moves', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true, groupId: 5 },
            { id: 12, groupId: 5 },
          ],
        },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'windowClosed',
    });

    expect(groupMoveSpy).not.toHaveBeenCalled();
    expect(moveSpy).not.toHaveBeenCalled();
  });

  test('redo: the window the tab went to closed since the undo: windowClosed, nothing moves', async () => {
    // W1 [11*, 12], W2 [21*, 22]; 12 goes to W2, is undone, then W2 closes.
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] },
        { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
      ],
    });
    const drop = await dropTab(tabMove(12, 1, 2, 1), false);
    const undone = await ran(runLiveStep(drop, 'undo', false));
    handle.browser.closeWindow(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // PREMISE: window 2 is gone.
    expect(
      (await chrome.windows.getAll({})).map((window) => window.id)
    ).toEqual([1]);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(undone, 'redo', false)).toEqual({
      outcome: 'windowClosed',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11*', '12']);
  });

  // CONTROL: the same undo with the old window still there runs.
  test('the old window still open: the undo runs and is done', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
    });
    const drop = await dropTab(tabMove(12, 1, 2, 1), false);

    expect(await runLiveStep(drop, 'undo', false)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip(1)).toEqual(['11*', '12']);
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

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'couldNotRun',
    });

    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
  });
});

// KAN-744 R7-R13: redo puts the tabs where the step left them, and both
// directions refuse when Chrome changed since.
describe('runLiveStep, redo', () => {
  test('redo puts a tab back where the drag left it', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(11, 1, 1, 2), false);
    const undone = await ran(runLiveStep(drop, 'undo', false));
    // PREMISE: the undo put it back.
    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);

    const redone = await runLiveStep(undone, 'redo', false);

    expect(redone).toMatchObject({ outcome: 'done' });
    expect((await chrome.tabs.get(11)).index).toBe(drop.moved[0]?.after.index);
    expect(await strip(1)).toEqual(['12', '13', '11*', '14']);
  });

  test('redo of a tab dragged across windows rejoins its group there', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(22, 2, 1, 2, 5), true);
    const undone = await ran(runLiveStep(drop, 'undo', true));
    expect(await strip(2)).toEqual(['21*', '22']);

    expect(await runLiveStep(undone, 'redo', true)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip(1)).toEqual(['11*', '12g5', '22g5', '13g5', '14']);
    expect(await strip(2)).toEqual(['21*']);
  });

  test('undo then redo of a group whose group Chrome removed: redo uses the rebuilt group', async () => {
    // W1 [11, 12g5*, 13g5, 14]; W2 [21, 22*, 23]: the drop goes by G1.
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
        { id: 2, tabs: [{ id: 21 }, { id: 22, active: true }, { id: 23 }] },
      ],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Gt', color: 'blue', collapsed: true },
      ],
    });
    const drop = await dropGroup(groupMove(5, 1, 2, 1));
    // The group holds W2's front tab, so the undo goes by G1 too: a new id.
    handle.browser.activateTab(12);
    const undone = await ran(runLiveStep(drop, 'undo', true));
    const rebuilt = await groupOf(12);
    // PREMISE: Chrome removed the drop's group, and the undo made another.
    expect(rebuilt).not.toBe(drop.moved[0]?.after.groupId);
    expect(rebuilt).not.toBe(5);

    const redone = await runLiveStep(undone, 'redo', true);

    // KAN-744 R8: the record the redo ran on was read after the undo.
    expect(undone.moved.map(({ before }) => before.groupId)).toEqual([
      rebuilt,
      rebuilt,
    ]);
    expect(redone).toMatchObject({ outcome: 'done' });
    const places = await Promise.all(
      [12, 13].map(async (id) => {
        const tab = await chrome.tabs.get(id);
        return [tab.windowId, tab.index, tab.groupId];
      })
    );
    expect(places).toEqual([
      [2, 1, rebuilt],
      [2, 2, rebuilt],
    ]);
    expect(handle.groupState(rebuilt)).toMatchObject({
      windowId: 2,
      title: 'Gt',
      color: 'blue',
      collapsed: true,
    });
  });

  test('redo is refused when a tab moved since the undo', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(11, 1, 1, 2), false);
    const undone = await ran(runLiveStep(drop, 'undo', false));
    await chrome.tabs.move(11, { index: 3 });
    const moved = await strip(1);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(undone, 'redo', false)).toEqual({
      outcome: 'changedSince',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(moved);
  });

  test('a tab whose window was closed since', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(12, 1, 2, 1), false);
    handle.browser.closeWindow(2);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'changedSince',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11*', '13', '14']);
  });

  test('a tab whose window was closed since the undo refuses the redo', async () => {
    handle = setupChromeFake(plain);
    const drop = await dropTab(tabMove(21, 2, 1, 1), false);
    const undone = await ran(runLiveStep(drop, 'undo', false));
    handle.browser.closeWindow(2);
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(undone, 'redo', false)).toEqual({
      outcome: 'changedSince',
    });

    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['11*', '12', '13', '14']);
  });

  test('without the grant, a group step cannot run (the sort: openNowSort.test.ts)', async () => {
    // W1 [11*, 12g5, 13g5, 14]: group 5 to the end.
    handle = setupChromeFake(grouped());
    const drop = await dropGroup(groupMove(5, 1, 1, 2));
    const dropped = await strip(1);
    const undone = await ran(runLiveStep(drop, 'undo', true));
    await ran(runLiveStep(undone, 'redo', true));
    // PREMISE: with the grant it ran both ways.
    expect(await strip(1)).toEqual(dropped);
    const groupMoveSpy = vi.spyOn(chrome.tabGroups, 'move');
    const moveSpy = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'couldNotRun',
    });

    expect(groupMoveSpy).not.toHaveBeenCalled();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(dropped);
  });

  test('CONTROL: without the grant, a tab step still runs', async () => {
    handle = setupChromeFake(grouped(true));
    const drop = await dropTab(tabMove(11, 1, 1, 3), false);

    expect(await runLiveStep(drop, 'undo', false)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
  });

  test('a re-read Chrome refuses after the run: couldNotRun, the tabs where Chrome left them', async () => {
    handle = setupChromeFake(grouped());
    const drop = await dropTab(tabMove(12, 1, 1, 3), true);
    // Only the re-read reads the group's look; putting the tab back does not.
    vi.spyOn(chrome.tabGroups, 'get').mockRejectedValue(new Error('refused'));

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'couldNotRun',
    });

    expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
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
