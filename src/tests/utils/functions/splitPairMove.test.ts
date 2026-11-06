import { afterEach, describe, expect, test, vi } from 'vitest';

import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeSeed } from '../../setup/chrome.fake';
import {
  carryPair,
  isStillOneSplit,
} from '../../../utils/functions/splitPairMove';
import { createSplitApi } from '../../../utils/functions/splitView';

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  handle?.restore();
  handle = undefined;
});

type Extra = Partial<chrome.tabs.Tab>;

// Window 1: tabs 10.. Window 2: tabs 20.. The split is 11 and 12 unless said.
const seed = (
  one: Extra[],
  two: Extra[] = [{ active: true }, {}, {}],
  more: Partial<ChromeSeed> = {}
) =>
  setupChromeFake({
    splitView: true,
    windows: [
      {
        id: 1,
        tabs: one.map((extra, i) => ({
          id: 10 + i,
          title: `T${10 + i}`,
          url: `https://t${10 + i}.test/`,
          ...extra,
        })),
      },
      {
        id: 2,
        tabs: two.map((extra, i) => ({
          id: 20 + i,
          title: `T${20 + i}`,
          url: `https://t${20 + i}.test/`,
          ...extra,
        })),
      },
    ],
    ...more,
  });

const splitTabs = async (ids: [number, number]) => {
  const api = createSplitApi();
  if (api === null) throw new Error('no createSplit');
  return api(ids);
};

const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId })).map((tab) => tab.id);

const expectOneSplit = async (a: number, b: number) => {
  const [first, second] = [await chrome.tabs.get(a), await chrome.tabs.get(b)];
  expect(first.splitViewId).toBeGreaterThan(0);
  expect(second.splitViewId).toBe(first.splitViewId);
};

const groupCount = async () => (await chrome.tabGroups.query({})).length;

const pair = { first: 11, second: 12 };
const loose = (windowId: number, index: number) => ({
  windowId,
  index,
  groupId: -1,
  pinned: false,
});

const fiveTabs: Extra[] = [{}, {}, {}, {}, {}];

describe('carryPair (KAN-486)', () => {
  test('moves later in the window by the group route', async () => {
    handle = seed(fiveTabs);
    const id = await splitTabs([11, 12]);
    expect(await carryPair(pair, loose(1, 3))).toBe(true);
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
    await expectOneSplit(11, 12);
    // The same split id: the group route never ended it, so the divider stays.
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
    expect(await groupCount()).toBe(0);
  });

  test('moves earlier in the window by the group route', async () => {
    handle = seed(fiveTabs);
    const id = await splitTabs([13, 14]);
    const later = { first: 13, second: 14 };
    expect(await carryPair(later, loose(1, 1))).toBe(true);
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
    expect((await chrome.tabs.get(13)).splitViewId).toBe(id);
    expect(await groupCount()).toBe(0);
  });

  test('moves to another window and hands back its front tab', async () => {
    handle = seed([{}, { active: true }, {}, {}, {}]);
    const id = await splitTabs([11, 12]);
    expect(await carryPair(pair, loose(2, 1))).toBe(true);
    expect(await strip(2)).toEqual([20, 11, 12, 21, 22]);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
    expect((await chrome.tabs.get(20)).active).toBe(true);
    expect((await chrome.tabs.get(11)).active).toBe(false);
    expect(await groupCount()).toBe(0);
  });

  test('moves within a window that is not the current one', async () => {
    handle = seed(fiveTabs, [{ active: true }, {}, {}, {}]);
    const id = await splitTabs([21, 22]);
    const inTwo = { first: 21, second: 22 };
    expect(await carryPair(inTwo, loose(2, 2))).toBe(true);
    expect(await strip(2)).toEqual([20, 23, 21, 22]);
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
    expect((await chrome.tabs.get(21)).splitViewId).toBe(id);
  });

  test('leaves the front tab alone when no half is active', async () => {
    handle = seed([{ active: true }, {}, {}, {}, {}]);
    await splitTabs([11, 12]);
    expect(await carryPair(pair, loose(2, 3))).toBe(true);
    expect(await strip(2)).toEqual([20, 21, 22, 11, 12]);
    expect((await chrome.tabs.get(20)).active).toBe(true);
    expect((await chrome.tabs.get(10)).active).toBe(true);
  });

  test.each([
    ['later', pair, [11, 12], 3, [10, 13, 14, 11, 12]],
    ['earlier', { first: 13, second: 14 }, [13, 14], 1, [10, 13, 14, 11, 12]],
  ] as const)(
    'takes the plain route without chrome.tabGroups, going %s',
    async (_name, moved, ids, index, expected) => {
      handle = seed(fiveTabs, undefined, { tabGroupsApiAbsent: true });
      const id = await splitTabs([ids[0], ids[1]]);
      expect(await carryPair(moved, loose(1, index))).toBe(true);
      expect(await strip(1)).toEqual(expected);
      await expectOneSplit(moved.first, moved.second);
      expect((await chrome.tabs.get(moved.first)).splitViewId).not.toBe(id);
    }
  );

  test('takes the plain route to another window without chrome.tabGroups', async () => {
    handle = seed(fiveTabs, undefined, { tabGroupsApiAbsent: true });
    await splitTabs([11, 12]);
    expect(await carryPair(pair, loose(2, 1))).toBe(true);
    expect(await strip(2)).toEqual([20, 11, 12, 21, 22]);
    await expectOneSplit(11, 12);
  });

  const runAtThirteen: Extra[] = [
    {},
    {},
    {},
    { groupId: 5 },
    { groupId: 5 },
    { groupId: 5 },
    {},
  ];

  test('joins a run at its head, keeping the split', async () => {
    handle = seed(runAtThirteen);
    const id = await splitTabs([11, 12]);
    const to = { ...loose(1, 1), groupId: 5 };
    expect(await carryPair(pair, to)).toBe(true);
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect((await chrome.tabs.get(11)).groupId).toBe(5);
    expect((await chrome.tabs.get(12)).groupId).toBe(5);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
    expect(await groupCount()).toBe(1);
  });

  test('joins a run at its tail, keeping the split', async () => {
    handle = seed(runAtThirteen);
    const id = await splitTabs([11, 12]);
    const to = { ...loose(1, 4), groupId: 5 };
    expect(await carryPair(pair, to)).toBe(true);
    expect(await strip(1)).toEqual([10, 13, 14, 15, 11, 12, 16]);
    expect((await chrome.tabs.get(12)).groupId).toBe(5);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
    expect(await groupCount()).toBe(1);
  });

  test('joins a run in another window at its tail', async () => {
    handle = seed(fiveTabs, [{ active: true }, { groupId: 5 }, { groupId: 5 }]);
    const id = await splitTabs([11, 12]);
    const to = { ...loose(2, 3), groupId: 5 };
    expect(await carryPair(pair, to)).toBe(true);
    expect(await strip(2)).toEqual([20, 21, 22, 11, 12]);
    expect((await chrome.tabs.get(11)).groupId).toBe(5);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
  });

  test('lands strictly inside a run, same window', async () => {
    handle = seed(runAtThirteen);
    await splitTabs([11, 12]);
    const to = { ...loose(1, 3), groupId: 5 };
    expect(await carryPair(pair, to)).toBe(true);
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12, 15, 16]);
    expect((await chrome.tabs.get(11)).groupId).toBe(5);
    expect((await chrome.tabs.get(12)).groupId).toBe(5);
    await expectOneSplit(11, 12);
    expect(await groupCount()).toBe(1);
  });

  test('lands strictly inside a run, another window', async () => {
    // Measured (probe 4 S1): tabs.group across takes no front tab, even with a half active.
    handle = seed(
      [{}, { active: true }, {}, {}, {}],
      [{ active: true }, { groupId: 5 }, { groupId: 5 }, { groupId: 5 }]
    );
    await splitTabs([11, 12]);
    const to = { ...loose(2, 2), groupId: 5 };
    expect(await carryPair(pair, to)).toBe(true);
    expect(await strip(2)).toEqual([20, 21, 11, 12, 22, 23]);
    expect((await chrome.tabs.get(12)).groupId).toBe(5);
    await expectOneSplit(11, 12);
    expect((await chrome.tabs.get(20)).active).toBe(true);
  });

  test('leaves a group, from the middle of its run', async () => {
    handle = seed([
      { groupId: 5 },
      { groupId: 5 },
      { groupId: 5 },
      { groupId: 5 },
      {},
    ]);
    const id = await splitTabs([11, 12]);
    expect(await carryPair(pair, loose(1, 3))).toBe(true);
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
    expect((await chrome.tabs.get(11)).groupId).toBe(-1);
    expect((await chrome.tabs.get(12)).groupId).toBe(-1);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
    expect(await groupCount()).toBe(1);
  });

  test('joins a group it stands beside without moving', async () => {
    handle = seed([{}, {}, {}, { groupId: 5 }, { groupId: 5 }]);
    const id = await splitTabs([11, 12]);
    const moves = vi.spyOn(chrome.tabGroups, 'move');
    expect(await carryPair(pair, { ...loose(1, 1), groupId: 5 })).toBe(true);
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
    expect((await chrome.tabs.get(11)).groupId).toBe(5);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
    expect(moves).not.toHaveBeenCalled();
  });

  test('pins both halves, into the run', async () => {
    handle = seed([{ pinned: true }, {}, {}, {}, {}]);
    await splitTabs([11, 12]);
    expect(await carryPair(pair, { ...loose(1, 0), pinned: true })).toBe(true);
    expect(await strip(1)).toEqual([11, 12, 10, 13, 14]);
    expect((await chrome.tabs.get(11)).pinned).toBe(true);
    expect((await chrome.tabs.get(12)).pinned).toBe(true);
    await expectOneSplit(11, 12);
    expect(await groupCount()).toBe(0);
  });

  test('unpins both halves, below the run', async () => {
    handle = seed([
      { pinned: true },
      { pinned: true },
      { pinned: true },
      {},
      {},
    ]);
    await splitTabs([11, 12]);
    expect(await carryPair(pair, loose(1, 2))).toBe(true);
    expect(await strip(1)).toEqual([10, 13, 11, 12, 14]);
    expect((await chrome.tabs.get(11)).pinned).toBe(false);
    expect((await chrome.tabs.get(12)).pinned).toBe(false);
    await expectOneSplit(11, 12);
  });

  test('a pinned pair moves within the pinned run, still pinned', async () => {
    handle = seed([
      { pinned: true },
      { pinned: true },
      { pinned: true },
      { pinned: true },
      {},
    ]);
    await splitTabs([11, 12]);
    const to = { ...loose(1, 2), pinned: true };
    expect(await carryPair(pair, to)).toBe(true);
    expect(await strip(1)).toEqual([10, 13, 11, 12, 14]);
    expect((await chrome.tabs.get(12)).pinned).toBe(true);
    await expectOneSplit(11, 12);
  });

  test('pins both halves in another window', async () => {
    handle = seed(fiveTabs, [{ pinned: true }, { pinned: true }, {}]);
    await splitTabs([11, 12]);
    const to = { ...loose(2, 1), pinned: true };
    expect(await carryPair(pair, to)).toBe(true);
    expect(await strip(2)).toEqual([20, 11, 12, 21, 22]);
    expect((await chrome.tabs.get(11)).pinned).toBe(true);
    expect((await chrome.tabs.get(12)).pinned).toBe(true);
    await expectOneSplit(11, 12);
  });

  test('leaves no temporary group when tabGroups.move is refused', async () => {
    handle = seed(fiveTabs);
    const id = await splitTabs([11, 12]);
    vi.spyOn(chrome.tabGroups, 'move').mockRejectedValueOnce(
      new Error('refused')
    );
    expect(await carryPair(pair, loose(1, 3))).toBe(false);
    expect(await groupCount()).toBe(0);
    expect((await chrome.tabs.get(11)).groupId).toBe(-1);
    expect((await chrome.tabs.get(12)).groupId).toBe(-1);
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
  });

  test('resolves false, tabs side by side, when createSplit is refused', async () => {
    handle = seed(fiveTabs, undefined, { tabGroupsApiAbsent: true });
    await splitTabs([11, 12]);
    Reflect.set(chrome.tabs, 'createSplit', () =>
      Promise.reject(new Error('refused'))
    );
    expect(await carryPair(pair, loose(1, 3))).toBe(false);
    expect(await strip(1)).toEqual([10, 13, 14, 11, 12]);
  });

  test('resolves false for two tabs that are not one split', async () => {
    handle = seed(fiveTabs);
    expect(await carryPair(pair, loose(1, 3))).toBe(false);
    expect(await strip(1)).toEqual([10, 11, 12, 13, 14]);
  });

  test('resolves false, nothing thrown, for a closed tab', async () => {
    handle = seed(fiveTabs);
    expect(await carryPair({ first: 99, second: 12 }, loose(1, 3))).toBe(false);
  });

  test('a drop in place calls nothing', async () => {
    handle = seed(fiveTabs);
    const id = await splitTabs([11, 12]);
    const group = vi.spyOn(chrome.tabs, 'group');
    const move = vi.spyOn(chrome.tabs, 'move');
    expect(await carryPair(pair, loose(1, 1))).toBe(true);
    expect(group).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect((await chrome.tabs.get(11)).splitViewId).toBe(id);
  });
});

describe('isStillOneSplit (KAN-486)', () => {
  test('true for both halves of one split', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    expect(await isStillOneSplit(pair)).toBe(true);
  });

  test('false once the split ended', async () => {
    handle = seed(fiveTabs);
    await splitTabs([11, 12]);
    await chrome.tabs.move(11, { index: 3 });
    expect(await isStillOneSplit(pair)).toBe(false);
  });

  test('false for halves of two splits', async () => {
    handle = seed(fiveTabs);
    await splitTabs([10, 11]);
    await splitTabs([12, 13]);
    expect(await isStillOneSplit(pair)).toBe(false);
  });

  test('false for a closed tab', async () => {
    handle = seed(fiveTabs);
    expect(await isStillOneSplit({ first: 99, second: 12 })).toBe(false);
  });
});
