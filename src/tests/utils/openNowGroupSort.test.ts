import { afterEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';
import { newestToast, toastTexts } from '../setup/toasts';
import { undoStep } from '../../redux/undoHistory';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { createSplitApi } from '../../utils/functions/splitView';
import {
  applyGroupOrder,
  canSortOpenGroupLive,
  isOpenGroupSortedBySite,
} from '../../utils/functions/openNowSort';
import { runLiveStep } from '../../utils/functions/openNowMoves';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';
import { sortOpenGroup, sortOpenGroupBySite } from '../../redux/sortOpenWindow';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { selectLiveStepOnTop } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-746. Open now sorts the tabs inside one real group by site, as one ⌘Z step.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const TAB_KEEPER = 'chrome-extension://faketestid/index.html';
const TRIP = 50;
const WORK = 60;

// z, then Trip [b a b a chrome://] out of order, then y, then Work [d c], already in order (one tab per site).
// `head`: tabs put first in Trip.
const seed = (
  head: Partial<chrome.tabs.Tab>[] = [],
  more: Partial<ChromeSeed> = {}
): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { id: 1, url: 'https://z.test/', active: true },
        ...head,
        { id: 2, url: 'https://b.test/1', groupId: TRIP },
        { id: 3, url: 'https://a.test/1', groupId: TRIP },
        { id: 4, url: 'https://b.test/2', groupId: TRIP },
        { id: 5, url: 'https://a.test/2', groupId: TRIP },
        { id: 6, url: 'chrome://settings', groupId: TRIP },
        { id: 7, url: 'https://y.test/' },
        { id: 8, url: 'https://d.test/', groupId: WORK },
        { id: 9, url: 'https://c.test/', groupId: WORK },
      ],
    },
  ],
  tabGroups: [
    { id: TRIP, windowId: 1, title: 'Trip', color: 'blue' },
    { id: WORK, windowId: 1, title: 'Work', color: 'red' },
  ],
  ...more,
});

const BEFORE = [
  '1',
  '2g50',
  '3g50',
  '4g50',
  '5g50',
  '6g50',
  '7',
  '8g60',
  '9g60',
];
const SORTED = [
  '1',
  '2g50',
  '4g50',
  '3g50',
  '5g50',
  '6g50',
  '7',
  '8g60',
  '9g60',
];

// A window's strip as Chrome has it: `gN` in group N.
const strip = async (windowId = 1) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map((t) => `${t.id}${t.groupId === -1 ? '' : `g${t.groupId}`}`);

async function sorted(groupId = TRIP): Promise<OpenNowDrop> {
  const drop = await sortOpenGroup(1, groupId, true);
  if (drop === null) throw new Error('PREMISE: the sort moved nothing');
  return drop;
}

async function snapshot(): Promise<OpenWindow> {
  const windows = await chrome.windows.getAll({ populate: true });
  const [window] = toOpenWindows(windows, await chrome.tabGroups.query({}), 1);
  if (window === undefined) throw new Error('PREMISE: no window');
  return window;
}

describe('sortOpenGroup', () => {
  test("sorts the group's tabs only, each out of place once, and records them as one step", async () => {
    handle = setupChromeFake(seed());
    const move = vi.spyOn(chrome.tabs, 'move');
    const groupMove = vi.spyOn(chrome.tabGroups, 'move');

    const drop = await sorted();

    expect(await strip()).toEqual(SORTED);
    expect(move).toHaveBeenCalledTimes(1);
    expect(groupMove).not.toHaveBeenCalled();
    expect(drop.kind).toBe('groupSort');
    expect(drop.moved.map((t) => t.tabId)).toEqual([2, 3, 4, 5, 6]);
  });

  test("the group's first tab out of place: only it moves, once (KAN-743)", async () => {
    // Trip [chrome:// a1 a2]: sorted, a1 and a2 are already in order and stay.
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://z.test/', active: true },
            { id: 2, url: 'chrome://settings', groupId: TRIP },
            { id: 3, url: 'https://a.test/1', groupId: TRIP },
            { id: 4, url: 'https://a.test/2', groupId: TRIP },
            { id: 5, url: 'https://y.test/' },
          ],
        },
      ],
      tabGroups: [{ id: TRIP, windowId: 1, title: 'Trip', color: 'blue' }],
    });
    const move = vi.spyOn(chrome.tabs, 'move');

    const drop = await sorted();

    expect(move.mock.calls.map(([id]) => id)).toEqual([2]);
    expect(await strip()).toEqual(['1', '3g50', '4g50', '2g50', '5']);
    move.mockClear();
    await runLiveStep(drop, 'undo', true);
    expect(move.mock.calls.map(([id]) => id)).toEqual([2]);
    expect(await strip()).toEqual(['1', '2g50', '3g50', '4g50', '5']);
  });

  test('⌘Z puts the group back and redo sorts it again', async () => {
    handle = setupChromeFake(seed());
    const undone = await runLiveStep(await sorted(), 'undo', true);
    if (undone.outcome !== 'done') throw new Error(undone.outcome);
    expect(await strip()).toEqual(BEFORE);

    expect(await runLiveStep(undone.drop, 'redo', true)).toMatchObject({
      outcome: 'done',
    });

    expect(await strip()).toEqual(SORTED);
  });

  test('the Tab Keeper page first in the group is never moved or recorded, and stays first in it', async () => {
    handle = setupChromeFake(
      seed([{ id: 10, url: TAB_KEEPER, groupId: TRIP }])
    );
    const move = vi.spyOn(chrome.tabs, 'move');

    const drop = await sorted();

    expect(move.mock.calls.map(([id]) => id)).not.toContain(10);
    expect(drop.moved.map((t) => t.tabId)).not.toContain(10);
    expect(await strip()).toEqual(['1', '10g50', ...SORTED.slice(1)]);
  });

  test('already sorted, or without the grant: no move, no step', async () => {
    handle = setupChromeFake(seed());
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await sortOpenGroup(1, WORK, false)).toBeNull();
    expect(move).not.toHaveBeenCalled();

    await sorted();
    move.mockClear();
    expect(await sortOpenGroup(1, TRIP, true)).toBeNull();
    expect(move).not.toHaveBeenCalled();
  });

  test('a group that is gone: no move, no step', async () => {
    handle = setupChromeFake(seed());
    expect(await sortOpenGroup(1, 999, true)).toBeNull();
    expect(await strip()).toEqual(BEFORE);
  });

  test('a split inside the group: nothing moves', async () => {
    handle = setupChromeFake({ ...seed(), splitView: true });
    const createSplit = createSplitApi();
    if (createSplit === null) throw new Error('PREMISE: no createSplit');
    const splitId = await createSplit([2, 3]);
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await sortOpenGroup(1, TRIP, true)).toBeNull();

    expect(move).not.toHaveBeenCalled();
    expect((await chrome.tabs.get(2)).splitViewId).toBe(splitId);
  });

  test('a split outside the group does not stop the sort, and is kept', async () => {
    handle = setupChromeFake({ ...seed(), splitView: true });
    const createSplit = createSplitApi();
    if (createSplit === null) throw new Error('PREMISE: no createSplit');
    const splitId = await createSplit([8, 9]);

    await sorted();

    expect((await chrome.tabs.get(8)).splitViewId).toBe(splitId);
    expect((await chrome.tabs.get(9)).splitViewId).toBe(splitId);
  });

  test('a member closed mid-sort stops without throwing, and Undo still runs', async () => {
    handle = setupChromeFake(seed());
    const real = chrome.tabs.move.bind(chrome.tabs);
    const move = vi
      .spyOn(chrome.tabs, 'move')
      .mockImplementation(
        async (...args: Parameters<typeof chrome.tabs.move>) => {
          const moved = await real(...args);
          await chrome.tabs.remove(5);
          return moved;
        }
      );

    const drop = await sorted();
    expect(move).toHaveBeenCalledTimes(1);
    move.mockRestore();

    expect(drop.moved.map((t) => t.tabId)).not.toContain(5);
    expect(await runLiveStep(drop, 'undo', true)).toMatchObject({
      outcome: 'done',
    });
    expect(await strip()).toEqual(BEFORE.filter((t) => t !== '5g50'));
  });
});

describe('a group sort step refused', () => {
  test('a tab added to the group since: ⌘Z moves nothing', async () => {
    handle = setupChromeFake(seed());
    const drop = await sorted();
    // One past the group's last tab: it does not join, and shifts no member.
    const added = await chrome.tabs.create({
      windowId: 1,
      url: 'https://a.test/3',
      index: 6,
    });
    await chrome.tabs.group({ groupId: TRIP, tabIds: [added.id!] });
    const now = await strip();
    // PREMISE: every member is where the sort left it, and the group holds one more.
    expect(now.slice(0, 7)).toEqual([...SORTED.slice(0, 6), `${added.id}g50`]);
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'changedSince',
    });

    expect(move).not.toHaveBeenCalled();
    expect(await strip()).toEqual(now);
  });

  test('a split made inside the group since: ⌘Z moves nothing, and the split is kept', async () => {
    handle = setupChromeFake({ ...seed(), splitView: true });
    const drop = await sorted();
    const createSplit = createSplitApi();
    if (createSplit === null) throw new Error('PREMISE: no createSplit');
    // Adjacent members after the sort: a split changes no index.
    const splitId = await createSplit([4, 3]);
    expect(await strip()).toEqual(SORTED);
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'changedSince',
    });

    expect(move).not.toHaveBeenCalled();
    expect((await chrome.tabs.get(4)).splitViewId).toBe(splitId);
  });

  test('a member moved by hand since: ⌘Z moves nothing', async () => {
    handle = setupChromeFake(seed());
    const drop = await sorted();
    await chrome.tabs.move(6, { index: 2 });
    const now = await strip();

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'changedSince',
    });

    expect(await strip()).toEqual(now);
  });

  test('without the grant, a group sort step cannot run', async () => {
    handle = setupChromeFake(seed());
    const drop = await sorted();

    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'couldNotRun',
    });
    expect(await strip()).toEqual(SORTED);
  });
});

describe('applyGroupOrder', () => {
  test("puts the group's tabs in the order given, inside the group's run", async () => {
    handle = setupChromeFake(seed());

    expect(await applyGroupOrder(1, TRIP, [6, 5, 4, 3, 2])).toBe(true);

    expect(await strip()).toEqual([
      '1',
      '6g50',
      '5g50',
      '4g50',
      '3g50',
      '2g50',
      '7',
      '8g60',
      '9g60',
    ]);
  });

  test('false when a tab in the order is not in the group', async () => {
    handle = setupChromeFake(seed());
    expect(await applyGroupOrder(1, TRIP, [3, 2, 7])).toBe(false);
    expect((await chrome.tabs.get(7)).groupId).toBe(-1);
  });
});

describe('sortOpenGroupBySite', () => {
  test('says so, with an Undo for the step it kept, when it sorted', async () => {
    handle = setupChromeFake(seed());
    const { store } = makeTestStore();
    store.dispatch(setHasTabGroupsPermission(true));

    await store.dispatch(sortOpenGroupBySite({ windowId: 1, groupId: TRIP }));

    expect(await strip()).toEqual(SORTED);
    const toasts = store.getState().globalState.toasts;
    expect(toasts.map((t) => t.text)).toEqual([
      TOAST_MESSAGES.TABS_SORTED_BY_SITE,
    ]);
    const step = selectLiveStepOnTop(store.getState());
    expect(step?.drop.kind).toBe('groupSort');
    expect(toasts[0]?.liveStepId).toBe(step?.id);
  });

  test('a refused ⌘Z says the sort cannot be undone, not that a move cannot', async () => {
    handle = setupChromeFake(seed());
    const { store } = makeTestStore();
    store.dispatch(setHasTabGroupsPermission(true));
    await store.dispatch(sortOpenGroupBySite({ windowId: 1, groupId: TRIP }));
    await chrome.tabs.move(6, { index: 2 });

    expect((await store.dispatch(undoStep())).payload).toBe('refused');

    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.UNDO_REFUSED_SORT
    );
  });

  test('says nothing when nothing changed, or without the grant', async () => {
    handle = setupChromeFake(seed());
    const run = async (granted: boolean) => {
      const { store } = makeTestStore();
      store.dispatch(setHasTabGroupsPermission(granted));
      await store.dispatch(sortOpenGroupBySite({ windowId: 1, groupId: TRIP }));
      return toastTexts(store.getState());
    };
    expect(await run(false)).toEqual([]);
    expect(await run(true)).toEqual([TOAST_MESSAGES.TABS_SORTED_BY_SITE]);
    expect(await run(true)).toEqual([]);
  });
});

describe('the group predicates on a snapshot', () => {
  test('one group reads as unsorted, then sorted; the other group is its own', async () => {
    handle = setupChromeFake(seed());
    expect(isOpenGroupSortedBySite(await snapshot(), TRIP)).toBe(false);
    expect(isOpenGroupSortedBySite(await snapshot(), WORK)).toBe(true);

    await sorted();

    expect(isOpenGroupSortedBySite(await snapshot(), TRIP)).toBe(true);
  });

  test('offered with the grant and no split in that group', async () => {
    handle = setupChromeFake({ ...seed(), splitView: true });
    expect(canSortOpenGroupLive(await snapshot(), TRIP, true)).toBe(true);
    expect(canSortOpenGroupLive(await snapshot(), TRIP, false)).toBe(false);
    const createSplit = createSplitApi();
    if (createSplit === null) throw new Error('PREMISE: no createSplit');
    await createSplit([8, 9]);
    expect(canSortOpenGroupLive(await snapshot(), TRIP, true)).toBe(true);
    await createSplit([2, 3]);
    expect(canSortOpenGroupLive(await snapshot(), TRIP, true)).toBe(false);
  });
});
