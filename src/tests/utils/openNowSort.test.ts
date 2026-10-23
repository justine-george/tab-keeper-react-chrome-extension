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

import { buildChromeTab } from '../fixtures/chromeTab';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';
import { toastTexts } from '../setup/toasts';
import { isTabKeeperPage } from '../../utils/functions/capture';
import { toOpenWindows } from '../../utils/functions/openNow';
import { createSplitApi } from '../../utils/functions/splitView';
import type { OpenWindow } from '../../utils/functions/openNow';
import {
  canSortOpenWindowLive,
  holdsSplitView,
  isOpenWindowSortedBySite,
  keptInPlace,
  liveOrderOf,
  liveSortOrder,
  orderBeforeSort,
  spotFor,
} from '../../utils/functions/openNowSort';
import type {
  LiveOrder,
  LiveTab,
  LiveUnit,
} from '../../utils/functions/openNowSort';
import { undoOpenNowDrop } from '../../utils/functions/openNowMoves';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';
import {
  noteTabKeeperAction,
  openNowDropHoldsUndoKey,
  takeOpenNowDrop,
} from '../../redux/openNowMoveUndo';
import {
  sortOpenWindow,
  sortOpenWindowBySite,
} from '../../redux/sortOpenWindow';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-694 Task 5. Open now sorts a real window by site, as one ⌘Z step.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  // A kept drop is module state: a later action retires it.
  noteTabKeeperAction();
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const TAB_KEEPER = 'chrome-extension://faketestid/index.html';
const GROUP = 900;

// The spec's example window ("The order"), by id.
const MOCK: Partial<chrome.tabs.Tab>[] = [
  { id: 1, url: 'https://mail.google.com/', pinned: true },
  { id: 2, url: 'https://calendar.google.com/', pinned: true },
  { id: 3, url: 'https://github.com/a/412' },
  { id: 4, url: 'https://docs.google.com/q4' },
  { id: 5, url: 'https://developer.mozilla.org/toSorted' },
  { id: 6, url: 'https://github.com/a/98' },
  { id: 7, url: 'https://www.booking.com/', groupId: GROUP },
  { id: 8, url: 'https://maps.google.com/', groupId: GROUP },
  { id: 9, url: 'https://en.wikipedia.org/wiki/Kyoto', groupId: GROUP },
  { id: 10, url: 'https://www.youtube.com/calm' },
  { id: 11, url: 'https://docs.google.com/launch' },
  { id: 12, url: 'https://en.wikipedia.org/wiki/Tab' },
  { id: 13, url: 'https://github.com/a/actions' },
  { id: 14, url: 'https://developer.mozilla.org/corner-shape' },
  { id: 15, url: 'https://youtube.com/ext' },
  { id: 16, url: 'https://docs.google.com/notes' },
];

const MOCK_SORTED: LiveOrder = {
  pinned: [1, 2],
  rest: [
    { kind: 'group', id: GROUP },
    ...[3, 6, 13, 4, 11, 16, 5, 14, 10, 15, 12].map((id) => ({
      kind: 'tab' as const,
      id,
    })),
  ],
};

const tabsOf = (seed: Partial<chrome.tabs.Tab>[]): chrome.tabs.Tab[] =>
  seed.map((tab, index) => buildChromeTab({ index, ...tab }));

describe('liveSortOrder', () => {
  test("the spec's example", () => {
    setupFakeForGetUrl();
    expect(liveSortOrder(tabsOf(MOCK), isTabKeeperPage)).toEqual(MOCK_SORTED);
  });

  test('leaves the Tab Keeper page out, loose or in a group', () => {
    setupFakeForGetUrl();
    const tabs = tabsOf([
      { id: 1, url: 'https://b.test/' },
      { id: 2, url: TAB_KEEPER },
      { id: 3, url: 'https://a.test/', groupId: 5 },
      { id: 4, url: TAB_KEEPER, groupId: 5 },
      { id: 5, url: 'https://a.test/' },
    ]);

    expect(liveSortOrder(tabs, isTabKeeperPage)).toEqual({
      pinned: [],
      rest: [
        { kind: 'group', id: 5 },
        { kind: 'tab', id: 1 },
        { kind: 'tab', id: 5 },
      ],
    });
  });

  test('groupId -1 is loose; each group is listed once, in first-seen order', () => {
    const tabs = tabsOf([
      { id: 1, url: 'https://z.test/', groupId: -1 },
      { id: 2, url: 'https://y.test/', groupId: 8 },
      { id: 3, url: 'https://x.test/', groupId: 8 },
      { id: 4, url: 'https://w.test/', groupId: 6 },
    ]);

    expect(liveSortOrder(tabs, () => false)).toEqual({
      pinned: [],
      rest: [
        { kind: 'group', id: 8 },
        { kind: 'group', id: 6 },
        { kind: 'tab', id: 1 },
      ],
    });
  });

  test('reads the strip by index, not by the order it was handed', () => {
    const tabs = tabsOf([
      { id: 1, url: 'https://b.test/' },
      { id: 2, url: 'https://a.test/' },
      { id: 3, url: 'https://b.test/' },
    ]).reverse();

    expect(liveSortOrder(tabs, () => false).rest).toEqual([
      { kind: 'tab', id: 1 },
      { kind: 'tab', id: 3 },
      { kind: 'tab', id: 2 },
    ]);
  });
});

describe('liveOrderOf', () => {
  test('the order as it stands: pinned, then groups and loose tabs in place', () => {
    expect(liveOrderOf(tabsOf(MOCK))).toEqual({
      pinned: [1, 2],
      rest: [
        { kind: 'tab', id: 3 },
        { kind: 'tab', id: 4 },
        { kind: 'tab', id: 5 },
        { kind: 'tab', id: 6 },
        { kind: 'group', id: GROUP },
        ...[10, 11, 12, 13, 14, 15, 16].map((id) => ({
          kind: 'tab' as const,
          id,
        })),
      ],
    });
  });
});

describe('orderBeforeSort', () => {
  test('rebuilds the order from the before indexes: pinned first, a group mid-window as one block', () => {
    const place = (index: number, groupId = -1) => ({
      windowId: 1,
      index,
      groupId,
      group: null,
    });
    // Before: 20P 21P 22 [23 24]g7 25; recorded in the order the sort left them.
    const records = [
      { tabId: 21, before: place(1), pinned: true },
      { tabId: 20, before: place(0), pinned: true },
      { tabId: 24, before: place(4, 7), pinned: false },
      { tabId: 23, before: place(3, 7), pinned: false },
      { tabId: 25, before: place(5), pinned: false },
      { tabId: 22, before: place(2), pinned: false },
    ];

    expect(orderBeforeSort(records)).toEqual({
      pinned: [20, 21],
      rest: [
        { kind: 'tab', id: 22 },
        { kind: 'group', id: 7 },
        { kind: 'tab', id: 25 },
      ],
    });
  });
});

describe('keptInPlace (KAN-743)', () => {
  test('nothing to keep in an empty window', () => {
    expect(keptInPlace([])).toEqual(new Set());
  });

  test('a window already in order keeps every unit', () => {
    expect(keptInPlace([0, 1, 2, 3])).toEqual(new Set([0, 1, 2, 3]));
  });

  test('a reversed window keeps one unit', () => {
    expect(keptInPlace([3, 2, 1, 0]).size).toBe(1);
  });

  test('one tab out of place: only it is left to move', () => {
    expect(keptInPlace([0, 1, 3, 4, 5, 6, 2])).toEqual(
      new Set([0, 1, 3, 4, 5, 6])
    );
  });

  test('between runs of equal length, the one ending last in the strip', () => {
    expect(keptInPlace([1, 3, 0, 2])).toEqual(new Set([0, 2]));
  });
});

describe('spotFor (KAN-743)', () => {
  // A strip in index order: each tab's index is its place in the list.
  const stripOf = (
    tabs: { id: number; groupId?: number; pinned?: boolean }[]
  ): LiveTab[] =>
    tabs.map(({ id, groupId = -1, pinned = false }, index) => ({
      id,
      index,
      groupId,
      pinned,
    }));
  const tab = (id: number): LiveUnit => ({ kind: 'tab', id });
  const group = (id: number): LiveUnit => ({ kind: 'group', id });

  test('the first unit goes to the start of its region', () => {
    const strip = stripOf([
      { id: 1, pinned: true },
      { id: 2, pinned: true },
      { id: 3 },
      { id: 4 },
    ]);
    expect(spotFor(strip, [tab(4), tab(3)], 0, 2)).toEqual({ from: 3, to: 2 });
  });

  test('moving left: right after the unit before it', () => {
    const strip = stripOf([1, 2, 3, 4, 5, 6].map((id) => ({ id })));
    expect(spotFor(strip, [tab(1), tab(2), tab(6)], 2, 0)).toEqual({
      from: 5,
      to: 2,
    });
  });

  test('moving right past a group: the index it ends at, after the group', () => {
    const strip = stripOf([
      { id: 1 },
      { id: 2 },
      { id: 3, groupId: 9 },
      { id: 4, groupId: 9 },
      { id: 5, groupId: 9 },
    ]);
    expect(spotFor(strip, [group(9), tab(1)], 1, 0)).toEqual({
      from: 0,
      to: 4,
    });
  });

  test("a group moving right: its first tab's index once it has moved", () => {
    const strip = stripOf([
      { id: 1, groupId: 9 },
      { id: 2, groupId: 9 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
    expect(spotFor(strip, [tab(5), group(9)], 1, 0)).toEqual({
      from: 0,
      to: 3,
    });
  });

  test('a group moving left: right after the unit before it', () => {
    const strip = stripOf([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
      { id: 6, groupId: 9 },
      { id: 7, groupId: 9 },
    ]);
    expect(spotFor(strip, [tab(2), group(9)], 1, 0)).toEqual({
      from: 5,
      to: 2,
    });
  });

  test('null when the unit or the one before it is gone from the strip', () => {
    const strip = stripOf([{ id: 1 }, { id: 2 }]);
    expect(spotFor(strip, [tab(1), tab(7)], 1, 0)).toBeNull();
    expect(spotFor(strip, [tab(7), tab(2)], 1, 0)).toBeNull();
  });
});

describe('holdsSplitView, canSortOpenWindowLive', () => {
  test('a split is a splitViewId of 0 or more; absent or -1 is none', () => {
    expect(holdsSplitView([{}, { splitViewId: -1 }])).toBe(false);
    expect(holdsSplitView([{}, { splitViewId: 0 }])).toBe(true);
    expect(holdsSplitView([{ splitViewId: 41 }])).toBe(true);
  });

  const window = (tabs: Partial<OpenWindow['tabs'][number]>[]): OpenWindow => ({
    id: 1,
    isThisWindow: false,
    tabs: tabs.map((tab, index) => ({
      id: index + 1,
      windowId: 1,
      title: '',
      url: '',
      favIconUrl: '',
      active: false,
      pinned: false,
      audible: false,
      muted: false,
      groupId: null,
      index,
      ...tab,
    })),
    groups: [],
    bounds: null,
    state: 'normal',
    incognito: false,
  });

  test('needs the tab group grant and no split', () => {
    expect(canSortOpenWindowLive(window([{}, {}]), true)).toBe(true);
    expect(canSortOpenWindowLive(window([{}, {}]), false)).toBe(false);
    expect(canSortOpenWindowLive(window([{}, { splitViewId: 3 }]), true)).toBe(
      false
    );
  });

  test('isOpenWindowSortedBySite reads the listed tabs', () => {
    expect(
      isOpenWindowSortedBySite(
        window([
          { url: 'https://a.test/1' },
          { url: 'https://a.test/2' },
          { url: 'https://b.test/' },
        ])
      )
    ).toBe(true);
    expect(
      isOpenWindowSortedBySite(
        window([
          { url: 'https://a.test/1' },
          { url: 'https://b.test/' },
          { url: 'https://a.test/2' },
        ])
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against the chrome fake: the moves, the record and the undo.

// Only for chrome.runtime.getURL, which isTabKeeperPage reads.
function setupFakeForGetUrl(): void {
  handle = setupChromeFake({});
}

// A window's strip as Chrome has it: `P` pinned, `gN` in group N.
const strip = async (windowId = 1) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map(
      (t) =>
        `${t.id}${t.pinned ? 'P' : ''}${t.groupId === -1 ? '' : `g${t.groupId}`}`
    );

const mockSeed = (extra: Partial<ChromeSeed> = {}): ChromeSeed => ({
  windows: [{ id: 1, tabs: [{ ...MOCK[0], active: true }, ...MOCK.slice(1)] }],
  tabGroups: [{ id: GROUP, windowId: 1, title: 'Kyoto trip', color: 'blue' }],
  ...extra,
});

const MOCK_STRIP = [
  '1P',
  '2P',
  '3',
  '4',
  '5',
  '6',
  `7g${GROUP}`,
  `8g${GROUP}`,
  `9g${GROUP}`,
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
];
const MOCK_SORTED_STRIP = [
  '1P',
  '2P',
  `7g${GROUP}`,
  `8g${GROUP}`,
  `9g${GROUP}`,
  '3',
  '6',
  '13',
  '4',
  '11',
  '16',
  '5',
  '14',
  '10',
  '15',
  '12',
];

// The drop ⌘Z would take now. Throws when none is kept.
function keptDrop(): OpenNowDrop {
  const drop = takeOpenNowDrop();
  if (drop === null) throw new Error('PREMISE: no drop was kept');
  return drop;
}

describe('sortOpenWindow', () => {
  test("sorts the spec's example, records every tab as one drop, and ⌘Z puts it back", async () => {
    handle = setupChromeFake(mockSeed());

    expect(await sortOpenWindow(1, true)).toBe(true);

    expect(await strip()).toEqual(MOCK_SORTED_STRIP);
    const drop = keptDrop();
    expect(drop.kind).toBe('sort');
    expect(drop.moved.map((tab) => tab.tabId).sort((a, b) => a - b)).toEqual(
      MOCK.map((tab) => tab.id)
    );

    await undoOpenNowDrop(drop, true);

    expect(await strip()).toEqual(MOCK_STRIP);
  });

  test('the Tab Keeper page is never moved or recorded, and keeps its group', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://b.test/', active: true },
            { id: 2, url: TAB_KEEPER },
            { id: 3, url: 'https://a.test/' },
            { id: 4, url: 'https://c.test/', groupId: 5 },
            { id: 5, url: TAB_KEEPER, groupId: 5 },
            { id: 6, url: 'https://b.test/2' },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'G', color: 'red' }],
    });
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await sortOpenWindow(1, true)).toBe(true);

    expect(move.mock.calls.map(([id]) => id)).not.toContain(2);
    expect(move.mock.calls.map(([id]) => id)).not.toContain(5);
    // The group first, then b, b, a; the loose page is passed over, so it ends first.
    expect(await strip()).toEqual(['2', '4g5', '5g5', '1', '6', '3']);
    const drop = keptDrop();
    expect(drop.moved.map((tab) => tab.tabId).sort()).toEqual([1, 3, 4, 6]);

    await undoOpenNowDrop(drop, true);

    expect(await strip()).toEqual(['2', '1', '3', '4g5', '5g5', '6']);
  });

  test('a pinned Tab Keeper page stays pinned and in the pinned run', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: TAB_KEEPER, pinned: true, active: true },
            { id: 2, url: 'https://b.test/', pinned: true },
            { id: 3, url: 'https://a.test/', pinned: true },
            { id: 4, url: 'https://b.test/2', pinned: true },
            { id: 5, url: 'https://z.test/' },
          ],
        },
      ],
    });

    expect(await sortOpenWindow(1, true)).toBe(true);

    expect(await strip()).toEqual(['2P', '4P', '3P', '1P', '5']);
  });

  test('already sorted: no move, no drop', async () => {
    handle = setupChromeFake(mockSeed());
    expect(await sortOpenWindow(1, true)).toBe(true);
    noteTabKeeperAction();
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await sortOpenWindow(1, true)).toBe(false);

    expect(move).not.toHaveBeenCalled();
    expect(openNowDropHoldsUndoKey()).toBe(false);
  });

  test('without the tab group grant: nothing moves, no drop', async () => {
    handle = setupChromeFake(mockSeed({ tabGroupsApiAbsent: true }));
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await sortOpenWindow(1, false)).toBe(false);

    expect(move).not.toHaveBeenCalled();
    expect(await strip()).toEqual(MOCK_STRIP);
    expect(openNowDropHoldsUndoKey()).toBe(false);
  });

  test('a window with a split view: nothing moves, no drop', async () => {
    handle = setupChromeFake({ ...mockSeed(), splitView: true });
    const createSplit = createSplitApi();
    if (createSplit === null) throw new Error('PREMISE: no createSplit');
    await createSplit([10, 11]);
    const move = vi.spyOn(chrome.tabs, 'move');

    expect(await sortOpenWindow(1, true)).toBe(false);

    expect(move).not.toHaveBeenCalled();
    expect(await strip()).toEqual(MOCK_STRIP);
    expect(openNowDropHoldsUndoKey()).toBe(false);
  });

  test('a move refused part way: stops, keeps what moved, and Undo puts it back', async () => {
    handle = setupChromeFake(mockSeed());
    const real = chrome.tabs.move.bind(chrome.tabs);
    let calls = 0;
    const move = vi
      .spyOn(chrome.tabs, 'move')
      .mockImplementation((...args: Parameters<typeof chrome.tabs.move>) => {
        calls += 1;
        // The two pinned moves and the first loose append go; the next is refused.
        if (calls === 4) return Promise.reject(new Error('No tab with id: 6.'));
        return real(...args);
      });

    expect(await sortOpenWindow(1, true)).toBe(true);

    // Stopped at the refusal: nothing after it was tried.
    expect(move).toHaveBeenCalledTimes(4);
    const midway = await strip();
    expect(midway).not.toEqual(MOCK_STRIP);
    expect(midway).not.toEqual(MOCK_SORTED_STRIP);
    move.mockRestore();
    const drop = keptDrop();

    await undoOpenNowDrop(drop, true);

    expect(await strip()).toEqual(MOCK_STRIP);
  });

  test('undo leaves a split made after the sort alone: no move, the split kept', async () => {
    handle = setupChromeFake({ ...mockSeed(), splitView: true });
    await sortOpenWindow(1, true);
    const drop = keptDrop();
    const createSplit = createSplitApi();
    if (createSplit === null) throw new Error('PREMISE: no createSplit');
    // Adjacent loose tabs after the sort (13, 4): a split changes no index.
    const splitId = await createSplit([13, 4]);
    expect(await strip()).toEqual(MOCK_SORTED_STRIP);
    const move = vi.spyOn(chrome.tabs, 'move');
    const groupMove = vi.spyOn(chrome.tabGroups, 'move');

    await undoOpenNowDrop(drop, true);

    expect(move).not.toHaveBeenCalled();
    expect(groupMove).not.toHaveBeenCalled();
    expect((await chrome.tabs.get(13)).splitViewId).toBe(splitId);
    expect((await chrome.tabs.get(4)).splitViewId).toBe(splitId);
  });

  test('undo leaves a window alone that holds a tab the sort never recorded', async () => {
    handle = setupChromeFake(mockSeed());
    await sortOpenWindow(1, true);
    const drop = keptDrop();
    // Opened at the end: no recorded index shifts.
    await chrome.tabs.create({ windowId: 1, url: 'https://new.test/' });
    const after = await strip();
    // PREMISE: the new tab is last and every recorded tab is where the sort left it.
    expect(after.slice(0, -1)).toEqual(MOCK_SORTED_STRIP);
    const move = vi.spyOn(chrome.tabs, 'move');
    const groupMove = vi.spyOn(chrome.tabGroups, 'move');

    await undoOpenNowDrop(drop, true);

    expect(move).not.toHaveBeenCalled();
    expect(groupMove).not.toHaveBeenCalled();
    expect(await strip()).toEqual(after);
  });

  test('a Tab Keeper page opened since does not stop the undo', async () => {
    handle = setupChromeFake(mockSeed());
    await sortOpenWindow(1, true);
    const drop = keptDrop();
    const page = await chrome.tabs.create({ windowId: 1, url: TAB_KEEPER });

    await undoOpenNowDrop(drop, true);

    expect((await strip()).filter((id) => id !== String(page.id))).toEqual(
      MOCK_STRIP
    );
  });

  test('undo does nothing when a recorded tab has moved since', async () => {
    handle = setupChromeFake(mockSeed());
    await sortOpenWindow(1, true);
    const drop = keptDrop();
    await chrome.tabs.move(16, { index: 3 });
    const moved = await strip();

    await undoOpenNowDrop(drop, true);

    expect(await strip()).toEqual(moved);
  });
});

describe('sortOpenWindowBySite', () => {
  async function run(granted: boolean): Promise<string[]> {
    const { store } = makeTestStore();
    store.dispatch(setHasTabGroupsPermission(granted));
    await store.dispatch(sortOpenWindowBySite(1));
    return toastTexts(store.getState());
  }

  test('says so, with an Undo for the live drop, when it sorted', async () => {
    handle = setupChromeFake(mockSeed());
    const { store } = makeTestStore();
    store.dispatch(setHasTabGroupsPermission(true));

    await store.dispatch(sortOpenWindowBySite(1));

    expect(await strip()).toEqual(MOCK_SORTED_STRIP);
    const toasts = store.getState().globalState.toasts;
    expect(toasts.map((t) => t.text)).toEqual([
      TOAST_MESSAGES.TABS_SORTED_BY_SITE,
    ]);
    expect(toasts[0]?.offersOpenNowUndo).toBe(true);
    expect(toasts[0]?.offersUndo).toBe(false);
    expect(openNowDropHoldsUndoKey()).toBe(true);
  });

  test('says nothing when nothing changed, or without the grant', async () => {
    handle = setupChromeFake(mockSeed());
    expect(await run(false)).toEqual([]);
    expect(await run(true)).toEqual([TOAST_MESSAGES.TABS_SORTED_BY_SITE]);
    expect(await run(true)).toEqual([]);
  });
});

// The snapshot Open now draws, for the predicates above against a real read.
describe('the predicates on a snapshot', () => {
  test('a sorted window reads as sorted, and the Tab Keeper page is not listed', async () => {
    handle = setupChromeFake(mockSeed());
    await sortOpenWindow(1, true);
    const windows = await chrome.windows.getAll({ populate: true });
    const [window] = toOpenWindows(
      windows,
      await chrome.tabGroups.query({}),
      1
    );
    if (window === undefined) throw new Error('PREMISE: no window');

    expect(isOpenWindowSortedBySite(window)).toBe(true);
    expect(canSortOpenWindowLive(window, true)).toBe(true);
  });
});
