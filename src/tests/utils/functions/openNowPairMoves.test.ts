import { afterEach, describe, expect, test, vi } from 'vitest';

import type { TabMove } from '../../../components/home/rightpane/rowDrag/dropRules';
import { toOpenWindows } from '../../../utils/functions/openNow';
import type { OpenWindow } from '../../../utils/functions/openNow';
import {
  changedAnyPlace,
  groupCopySlot,
  moveOpenPair,
  moveOpenTab,
  runLiveStep,
  tabCopySlot,
} from '../../../utils/functions/openNowMoves';
import type {
  LiveRun,
  OpenNowDrop,
} from '../../../utils/functions/openNowMoves';
import { createSplitApi } from '../../../utils/functions/splitView';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-486. Every record here is one moveOpenPair really produced against the fake.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  handle?.restore();
  handle = undefined;
});

type Extra = Partial<chrome.tabs.Tab>;

const tabsOf = (start: number, extras: Extra[]) =>
  extras.map((extra, i) => ({
    id: start + i,
    title: `T${start + i}`,
    url: `https://t${start + i}.test/`,
    ...extra,
  }));

const seed = (
  one: Extra[],
  two: Extra[] = [{ active: true }, {}, {}],
  more: Partial<ChromeSeed> = {}
) =>
  setupChromeFake({
    splitView: true,
    windows: [
      { id: 1, tabs: tabsOf(10, one) },
      { id: 2, tabs: tabsOf(20, two) },
    ],
    ...more,
  });

const splitTabs = async (ids: [number, number]) => {
  const api = createSplitApi();
  if (api === null) throw new Error('no createSplit');
  return api(ids);
};

async function snapshot(): Promise<OpenWindow[]> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map((tab) => tab.id);

const expectOneSplit = async (a: number, b: number) => {
  const first = await chrome.tabs.get(a);
  expect(first.splitViewId).toBeGreaterThan(0);
  expect((await chrome.tabs.get(b)).splitViewId).toBe(first.splitViewId);
};

const pairMove = (
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

async function dropPair(
  move: TabMove,
  hasTabGroups = true
): Promise<OpenNowDrop> {
  const moved = await moveOpenPair(move, await snapshot(), hasTabGroups);
  if (moved === null) throw new Error('PREMISE: the drop was refused');
  return { kind: 'pair', moved };
}

async function ran(run: Promise<LiveRun>): Promise<OpenNowDrop> {
  const result = await run;
  if (result.outcome !== 'done') {
    throw new Error(`PREMISE: the run was ${result.outcome}`);
  }
  return result.drop;
}

const fiveTabs: Extra[] = [{}, {}, {}, {}, {}];

describe('moveOpenPair (KAN-486)', () => {
  test('records both tabs, before and after', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    // Rows without the pair: 10 13 14. Row 2 is before 14.
    const moved = await moveOpenPair(
      pairMove(11, 1, 1, 2),
      await snapshot(),
      true
    );
    expect(await strip(1)).toEqual([10, 13, 11, 12, 14]);
    await expectOneSplit(11, 12);
    expect(
      moved?.map(({ tabId, before, after }) => [
        tabId,
        before.index,
        after.index,
      ])
    ).toEqual([
      [11, 1, 2],
      [12, 2, 3],
    ]);
  });

  test('moves to the end of the window, past every row', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    await dropPair(pairMove(11, 1, 1, 3));
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
  });

  test('moves to another window', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    await dropPair(pairMove(11, 1, 2, 1));
    expect(await strip(2)).toEqual([20, 11, 12, 21, 22]);
    await expectOneSplit(11, 12);
  });

  test('refuses when the split ended during the hold', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const windows = await snapshot();
    // Ended where it stands, so only the split check can see it.
    await chrome.tabs.move(11, { index: 1 });
    expect(await moveOpenPair(pairMove(11, 1, 1, 3), windows, true)).toBeNull();
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
  });

  test('refuses when a half closed during the hold', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const windows = await snapshot();
    await chrome.tabs.remove(12);
    expect(await moveOpenPair(pairMove(11, 1, 1, 3), windows, true)).toBeNull();
    expect(await strip(1)).toEqual([10, 11, 13, 14]);
  });

  test('refuses a window of the other profile', async () => {
    handle = setupChromeFake({
      splitView: true,
      windows: [
        { id: 1, tabs: tabsOf(10, fiveTabs) },
        { id: 2, incognito: true, tabs: tabsOf(20, [{}, {}]) },
      ],
    });
    await splitTabs([11, 12]);
    expect(
      await moveOpenPair(pairMove(11, 1, 2, 1), await snapshot(), true)
    ).toBeNull();
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
  });

  test('refuses a tab that is no head of a pair', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const windows = await snapshot();
    expect(await moveOpenPair(pairMove(12, 1, 1, 3), windows, true)).toBeNull();
    expect(await moveOpenPair(pairMove(13, 1, 1, 0), windows, true)).toBeNull();
  });

  test('a drop in place calls nothing', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const windows = await snapshot();
    const group = vi.spyOn(chrome.tabs, 'group');
    const move = vi.spyOn(chrome.tabs, 'move');
    const moved = await moveOpenPair(pairMove(11, 1, 1, 1), windows, true);
    expect(group).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(moved).not.toBeNull();
    expect(changedAnyPlace(moved ?? [])).toBe(false);
  });

  test('lands past a hidden Tab Keeper page at the slot', async () => {
    const page = { url: 'chrome-extension://faketestid/index.html' };
    handle = seed([{}, {}, {}, {}, page, {}]);
    await splitTabs([11, 12]);
    // Rows without the pair: 10 13 15. Row 2 is before 15, past the page at 14.
    await dropPair(pairMove(11, 1, 1, 2));
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12, 15]);
    await expectOneSplit(11, 12);
  });

  test('joins a band, keeping the split id', async () => {
    handle = seed([{}, {}, {}, { groupId: 5 }, { groupId: 5 }]);
    const id = await splitTabs([11, 12]);
    await dropPair(pairMove(11, 1, 1, 3, 5));
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
    expect((await chrome.tabs.get(12)).groupId).toBe(5);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
  });

  test('lands before a run a hidden page starts, loose, with the grant', async () => {
    const page = {
      url: 'chrome-extension://faketestid/index.html',
      groupId: 5,
    };
    handle = seed([{}, {}, {}, page, { groupId: 5 }, {}]);
    await splitTabs([11, 12]);
    // Rows without the pair: 10 14 15. Row 1 is 14, inside the run the page starts.
    await dropPair(pairMove(11, 1, 1, 1));
    expect((await chrome.tabs.get(11)).groupId).toBe(-1);
    await expectOneSplit(11, 12);
  });

  test('without the grant, into a run in its window, Chrome joins both', async () => {
    handle = seed(
      [{}, {}, {}, { groupId: 5 }, { groupId: 5 }, { groupId: 5 }],
      undefined,
      { tabGroupsApiAbsent: true }
    );
    await splitTabs([11, 12]);
    // Rows without the pair: 10 13 14 15. Row 2 is 14, inside the run.
    await dropPair(pairMove(11, 1, 1, 2), false);
    expect(await strip(1)).toEqual([10, 13, 11, 12, 14, 15]);
    expect((await chrome.tabs.get(11)).groupId).toBe(5);
    await expectOneSplit(11, 12);
  });

  test('without the grant, into a run in another window, both join', async () => {
    handle = seed(
      fiveTabs,
      [{ active: true }, { groupId: 5 }, { groupId: 5 }],
      { tabGroupsApiAbsent: true }
    );
    await splitTabs([11, 12]);
    await dropPair(pairMove(11, 1, 2, 2), false);
    expect(await strip(2)).toEqual([20, 21, 11, 12, 22]);
    expect((await chrome.tabs.get(12)).groupId).toBe(5);
    await expectOneSplit(11, 12);
  });

  test('into the pinned run pins both', async () => {
    handle = seed([{ pinned: true }, {}, {}, {}, {}]);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 0));
    expect(await strip(1)).toEqual([11, 12, 10, 13, 14]);
    expect(drop.moved.map((tab) => tab.after.pinned)).toEqual([true, true]);
    await expectOneSplit(11, 12);
  });
});

describe('rows count a pair once (KAN-486)', () => {
  test('a tab dropped below a pair lands after both halves', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    // Rows without tab 10: pair, 13, 14. Row 1 is 13.
    await moveOpenTab(pairMove(10, 1, 1, 1), await snapshot(), true);
    expect(await strip(1)).toEqual([11, 12, 10, 13, 14]);
    await expectOneSplit(11, 12);
  });

  test('a tab dropped above a pair lands before both halves', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    // Rows without tab 14: 10, pair, 13. Row 1 is the pair.
    await moveOpenTab(pairMove(14, 1, 1, 1), await snapshot(), true);
    expect(await strip(1)).toEqual([10, 14, 11, 12, 13]);
    await expectOneSplit(11, 12);
  });

  test('a tab at the boundary below a pinned pair keeps its pin', async () => {
    handle = seed([{ pinned: true }, { pinned: true }, {}, {}]);
    await splitTabs([10, 11]);
    // Rows without tab 13: pair (pinned), 12. Row 1 is the boundary, keeps it unpinned.
    await moveOpenTab(pairMove(13, 1, 1, 1), await snapshot(), true);
    expect(await strip(1)).toEqual([10, 11, 13, 12]);
    expect((await chrome.tabs.get(13)).pinned).toBe(false);
  });

  test('a saved tab never lands between the halves', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const windows = await snapshot();
    const below = tabCopySlot(windows, '1', 2, false, undefined, true);
    expect(below?.index).toBe(3);
    const at = tabCopySlot(windows, '1', 1, false, undefined, true);
    expect(at?.index).toBe(1);
  });

  test('a saved group never lands between the halves', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const windows = await snapshot();
    expect(groupCopySlot(windows, '1', 2)?.index).toBe(3);
    expect(groupCopySlot(windows, '1', 1)?.index).toBe(1);
  });

  test('a pair at the end of a group counts in the run', async () => {
    handle = seed([{ groupId: 5 }, { groupId: 5 }, { groupId: 5 }, {}, {}]);
    await splitTabs([11, 12]);
    const windows = await snapshot();
    // Top-level rows: group, 13, 14. Row 1 is 13.
    expect(groupCopySlot(windows, '1', 1)?.index).toBe(3);
  });
});

describe('a pair step undone and redone (KAN-486)', () => {
  test('undo puts a pair back as one split, same window', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 3));
    await ran(runLiveStep(drop, 'undo', true));
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
    await expectOneSplit(11, 12);
  });

  test('undo puts a pair back across windows, and redo sends it again', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 2, 1));
    const undone = await ran(runLiveStep(drop, 'undo', true));
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
    await expectOneSplit(11, 12);
    await ran(runLiveStep(undone, 'redo', true));
    expect(await strip(2)).toEqual([20, 11, 12, 21, 22]);
    await expectOneSplit(11, 12);
  });

  test('redo moves it again as one split, without the grant', async () => {
    handle = seed(fiveTabs, undefined, { tabGroupsApiAbsent: true });
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 3), false);
    const undone = await ran(runLiveStep(drop, 'undo', false));
    await expectOneSplit(11, 12);
    await ran(runLiveStep(undone, 'redo', false));
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
    await expectOneSplit(11, 12);
  });

  test('undo takes a pin change back', async () => {
    handle = seed([{ pinned: true }, {}, {}, {}, {}]);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 0));
    await ran(runLiveStep(drop, 'undo', true));
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
    expect((await chrome.tabs.get(11)).pinned).toBe(false);
    await expectOneSplit(11, 12);
  });

  test('undo rejoins the group it left', async () => {
    handle = seed([
      { groupId: 5 },
      { groupId: 5 },
      { groupId: 5 },
      { groupId: 5 },
      {},
    ]);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 2));
    expect((await chrome.tabs.get(11)).groupId).toBe(-1);
    await ran(runLiveStep(drop, 'undo', true));
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
    expect((await chrome.tabs.get(12)).groupId).toBe(5);
    await expectOneSplit(11, 12);
  });

  test('undo rebuilds a group the pair emptied, both halves in it', async () => {
    handle = seed([{}, { groupId: 5 }, { groupId: 5 }, {}, {}], undefined, {
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 3));
    expect((await chrome.tabGroups.query({})).length).toBe(0);
    await ran(runLiveStep(drop, 'undo', true));
    const first = await chrome.tabs.get(11);
    expect((await chrome.tabs.get(12)).groupId).toBe(first.groupId);
    const [group] = await chrome.tabGroups.query({});
    expect(group?.title).toBe('Work');
    expect(group?.color).toBe('blue');
    await expectOneSplit(11, 12);
  });

  test('undo is changedSince when the user ended the split', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 3));
    // Ended where it stands: a tabs.move to its own index ends it in the fake.
    await chrome.tabs.move(11, { index: 3 });
    const run = await runLiveStep(drop, 'undo', true);
    expect(run.outcome).toBe('changedSince');
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
  });

  test('undo is changedSince when a tab moved since', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 1, 3));
    await chrome.tabs.move(10, { index: 4 });
    const run = await runLiveStep(drop, 'undo', true);
    expect(run.outcome).toBe('changedSince');
  });

  test("undo is windowClosed when the pair's window is gone", async () => {
    handle = seed(fiveTabs, [{ active: true }]);
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 2, 1));
    await chrome.windows.remove(1);
    const run = await runLiveStep(drop, 'undo', true);
    expect(run.outcome).toBe('windowClosed');
  });

  test('a pair step runs without the grant', async () => {
    handle = seed(fiveTabs, undefined, { tabGroupsApiAbsent: true });
    await splitTabs([11, 12]);
    const drop = await dropPair(pairMove(11, 1, 2, 1), false);
    const run = await runLiveStep(drop, 'undo', false);
    expect(run.outcome).toBe('done');
  });
});
