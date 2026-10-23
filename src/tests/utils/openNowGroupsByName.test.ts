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
  applyGroupSlots,
  isOpenWindowGroupsSortedByName,
} from '../../utils/functions/openNowSort';
import { runLiveStep } from '../../utils/functions/openNowMoves';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';
import {
  sortOpenGroupsByName,
  sortOpenWindowGroupsByName,
} from '../../redux/sortOpenWindow';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { selectLiveStepOnTop } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-746 Part 2. Open now sorts a real window's groups by name: only the groups move, into the slots groups held, as one ⌘Z step.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const TAB_KEEPER = 'chrome-extension://faketestid/index.html';
const Z = 50; // "Zulu 10"
const A = 60; // "zulu 2"
const U = 70; // unnamed
const B = 80; // "Alpha"

// Slots: 1, Z [2 3], 4, A [5], U [6], 7, B [8]. `extra`: tabs put after 7.
const seed = (
  extra: Partial<chrome.tabs.Tab>[] = [],
  more: Partial<ChromeSeed> = {}
): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { id: 1, url: 'https://a.test/1', active: true },
        { id: 2, url: 'https://a.test/2', groupId: Z },
        { id: 3, url: 'https://a.test/3', groupId: Z },
        { id: 4, url: 'https://a.test/4' },
        { id: 5, url: 'https://a.test/5', groupId: A },
        { id: 6, url: 'https://a.test/6', groupId: U },
        { id: 7, url: 'https://a.test/7' },
        ...extra,
        { id: 8, url: 'https://a.test/8', groupId: B },
      ],
    },
  ],
  tabGroups: [
    { id: Z, windowId: 1, title: 'Zulu 10', color: 'blue' },
    { id: A, windowId: 1, title: 'zulu 2', color: 'red' },
    { id: U, windowId: 1, title: '', color: 'grey' },
    { id: B, windowId: 1, title: 'Alpha', color: 'green' },
  ],
  ...more,
});

const BEFORE = ['1', '2g50', '3g50', '4', '5g60', '6g70', '7', '8g80'];
// Slots: 1, B, 4, A, Z, 7, U.
const SORTED = ['1', '8g80', '4', '5g60', '2g50', '3g50', '7', '6g70'];

// A window's strip as Chrome has it: `gN` in group N.
const strip = async (windowId = 1) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map((t) => `${t.id}${t.groupId === -1 ? '' : `g${t.groupId}`}`);

async function sorted(): Promise<OpenNowDrop> {
  const drop = await sortOpenGroupsByName(1, 'en', true);
  if (drop === null) throw new Error('PREMISE: the sort moved nothing');
  return drop;
}

async function snapshot(): Promise<OpenWindow> {
  const windows = await chrome.windows.getAll({ populate: true });
  const [window] = toOpenWindows(windows, await chrome.tabGroups.query({}), 1);
  if (window === undefined) throw new Error('PREMISE: no window');
  return window;
}

describe('sortOpenGroupsByName', () => {
  test('moves only groups, each out of place once, and records the window as one step', async () => {
    handle = setupChromeFake(seed());
    const move = vi.spyOn(chrome.tabs, 'move');
    const groupMove = vi.spyOn(chrome.tabGroups, 'move');

    const drop = await sorted();

    expect(await strip()).toEqual(SORTED);
    expect(move).not.toHaveBeenCalled();
    // A ("zulu 2") is already in its slot: it stays still (KAN-743).
    expect(groupMove.mock.calls.map(([id]) => id).sort()).toEqual([Z, U, B]);
    expect(drop.kind).toBe('groupOrder');
    expect(drop.moved.map((t) => t.tabId).sort()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  test('⌘Z puts the groups back, moving only groups, and redo sorts them again', async () => {
    handle = setupChromeFake(seed());
    const drop = await sorted();
    const move = vi.spyOn(chrome.tabs, 'move');

    const undone = await runLiveStep(drop, 'undo', true);
    if (undone.outcome !== 'done') throw new Error(undone.outcome);
    expect(await strip()).toEqual(BEFORE);
    expect(move).not.toHaveBeenCalled();

    expect(await runLiveStep(undone.drop, 'redo', true)).toMatchObject({
      outcome: 'done',
    });
    expect(await strip()).toEqual(SORTED);
  });

  test('a loose Tab Keeper page keeps its slot and is not recorded', async () => {
    handle = setupChromeFake(seed([{ id: 10, url: TAB_KEEPER }]));

    const drop = await sorted();

    expect(drop.moved.map((t) => t.tabId)).not.toContain(10);
    expect(await strip()).toEqual([...SORTED.slice(0, 7), '10', '6g70']);
  });

  test('already in order, without the grant, or with one group: no move, no step', async () => {
    handle = setupChromeFake(seed());
    const groupMove = vi.spyOn(chrome.tabGroups, 'move');

    expect(await sortOpenGroupsByName(1, 'en', false)).toBeNull();
    expect(groupMove).not.toHaveBeenCalled();

    await sorted();
    groupMove.mockClear();
    expect(await sortOpenGroupsByName(1, 'en', true)).toBeNull();
    expect(groupMove).not.toHaveBeenCalled();
    handle.restore();

    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://a.test/1', active: true },
            { id: 2, url: 'https://a.test/2', groupId: Z },
          ],
        },
      ],
      tabGroups: [{ id: Z, windowId: 1, title: 'Zulu', color: 'blue' }],
    });
    expect(await sortOpenGroupsByName(1, 'en', true)).toBeNull();
  });

  test('a window that is gone: no step', async () => {
    handle = setupChromeFake(seed());
    expect(await sortOpenGroupsByName(999, 'en', true)).toBeNull();
  });

  test('splits inside a group and among the loose tabs run through the sort and are kept', async () => {
    handle = setupChromeFake({
      ...seed([{ id: 9, url: 'https://a.test/9' }]),
      splitView: true,
    });
    const createSplit = createSplitApi();
    if (createSplit === null) throw new Error('PREMISE: no createSplit');
    const inGroup = await createSplit([2, 3]);
    const loose = await createSplit([7, 9]);
    const before = await strip();

    await sorted();

    expect(await strip()).not.toEqual(before);
    expect((await chrome.tabs.get(2)).splitViewId).toBe(inGroup);
    expect((await chrome.tabs.get(3)).splitViewId).toBe(inGroup);
    expect((await chrome.tabs.get(7)).splitViewId).toBe(loose);
    expect((await chrome.tabs.get(9)).splitViewId).toBe(loose);
  });

  test('compares in the language given', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://a.test/1', active: true, groupId: Z },
            { id: 2, url: 'https://a.test/2', groupId: A },
          ],
        },
      ],
      tabGroups: [
        { id: Z, windowId: 1, title: 'Ört', color: 'blue' },
        { id: A, windowId: 1, title: 'Zebra', color: 'red' },
      ],
    });
    // German sorts ö with o: already in order. Swedish puts it after z.
    expect(await sortOpenGroupsByName(1, 'de', true)).toBeNull();
    expect(await sortOpenGroupsByName(1, 'sv', true)).not.toBeNull();
    expect(await strip()).toEqual(['2g60', '1g50']);
  });
});

describe('a groups-by-name step refused', () => {
  test('a tab moved by hand since: ⌘Z moves nothing', async () => {
    handle = setupChromeFake(seed());
    const drop = await sorted();
    await chrome.tabs.move(7, { index: 0 });
    const now = await strip();
    const groupMove = vi.spyOn(chrome.tabGroups, 'move');

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'changedSince',
    });

    expect(groupMove).not.toHaveBeenCalled();
    expect(await strip()).toEqual(now);
  });

  test('a tab opened in the window since: ⌘Z moves nothing', async () => {
    handle = setupChromeFake(seed());
    const drop = await sorted();
    await chrome.tabs.create({ windowId: 1, url: 'https://a.test/9' });
    const now = await strip();

    expect(await runLiveStep(drop, 'undo', true)).toEqual({
      outcome: 'changedSince',
    });

    expect(await strip()).toEqual(now);
  });

  test('without the grant, the step cannot run', async () => {
    handle = setupChromeFake(seed());
    const drop = await sorted();

    expect(await runLiveStep(drop, 'undo', false)).toEqual({
      outcome: 'couldNotRun',
    });
    expect(await strip()).toEqual(SORTED);
  });
});

describe('applyGroupSlots', () => {
  test('false, before any move, when the groups given are not the window’s groups', async () => {
    handle = setupChromeFake(seed());
    const groupMove = vi.spyOn(chrome.tabGroups, 'move');

    expect(await applyGroupSlots(1, [B, A, Z])).toBe(false);
    expect(await applyGroupSlots(1, [B, A, Z, U, 999])).toBe(false);

    expect(groupMove).not.toHaveBeenCalled();
    expect(await strip()).toEqual(BEFORE);
  });
});

describe('sortOpenWindowGroupsByName', () => {
  test('says so, with an Undo for the step it kept', async () => {
    handle = setupChromeFake(seed());
    const { store } = makeTestStore();
    store.dispatch(setHasTabGroupsPermission(true));

    await store.dispatch(
      sortOpenWindowGroupsByName({ windowId: 1, locale: 'en' })
    );

    expect(await strip()).toEqual(SORTED);
    const toasts = store.getState().globalState.toasts;
    expect(toasts.map((t) => t.text)).toEqual([
      TOAST_MESSAGES.GROUPS_SORTED_BY_NAME,
    ]);
    const step = selectLiveStepOnTop(store.getState());
    expect(step?.drop.kind).toBe('groupOrder');
    expect(toasts[0]?.liveStepId).toBe(step?.id);
  });

  test('a refused ⌘Z says the sort cannot be undone', async () => {
    handle = setupChromeFake(seed());
    const { store } = makeTestStore();
    store.dispatch(setHasTabGroupsPermission(true));
    await store.dispatch(
      sortOpenWindowGroupsByName({ windowId: 1, locale: 'en' })
    );
    await chrome.tabs.move(7, { index: 0 });

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
      await store.dispatch(
        sortOpenWindowGroupsByName({ windowId: 1, locale: 'en' })
      );
      return toastTexts(store.getState());
    };
    expect(await run(false)).toEqual([]);
    expect(await run(true)).toEqual([TOAST_MESSAGES.GROUPS_SORTED_BY_NAME]);
    expect(await run(true)).toEqual([]);
  });
});

describe('isOpenWindowGroupsSortedByName', () => {
  test('false while groups are out of name order, true once sorted', async () => {
    handle = setupChromeFake(seed());
    expect(isOpenWindowGroupsSortedByName(await snapshot(), 'en')).toBe(false);
    await sorted();
    expect(isOpenWindowGroupsSortedByName(await snapshot(), 'en')).toBe(true);
  });
});
