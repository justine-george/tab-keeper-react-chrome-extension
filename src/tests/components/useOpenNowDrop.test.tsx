import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';

// Spied, not replaced: the real moves still run against the fake, so a test
// can prove both that a refused drop never reached them and that an accepted
// one did what Chrome does.
vi.mock('../../utils/functions/openNowMoves', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/functions/openNowMoves')>();
  return {
    ...actual,
    moveOpenTab: vi.fn(actual.moveOpenTab),
    moveOpenGroup: vi.fn(actual.moveOpenGroup),
  };
});

import {
  openDragWindows,
  useOpenNowDrop,
} from '../../components/home/opennow/useOpenNowDrop';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { moveOpenGroup, moveOpenTab } from '../../utils/functions/openNowMoves';
import {
  selectLiveStepOnTop,
  setPresentStartup,
} from '../../redux/slices/undoRedoSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { undoStep } from '../../redux/undoHistory';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

// KAN-280 Part E, Task 6c. What an Open now drag MEANS, apart from how the
// engine drives it: the windows as the drop geometry reads them, where a held
// row may land in a window (landingRange, O11c), which windows take it at all
// (acceptsWindow: O11d, T1), and that a drop becomes the Chrome calls of
// openNowMoves.ts -- or none, when the geometry describes no move.

let handle: ChromeFakeHandle | undefined;

beforeEach(() => {
  vi.mocked(moveOpenTab).mockClear();
  vi.mocked(moveOpenGroup).mockClear();
});

afterEach(() => {
  cleanup();
  handle?.restore();
  handle = undefined;
});

// The hook keeps a drop in this store's undo history (KAN-744 R1).
function storeWrapper() {
  const { store } = makeTestStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, wrapper };
}

// The tab view's own address, which Open now leaves out (the same trick as
// openNowPinned.test.tsx).
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const url = (name: string) => `https://${name}.test/`;

// The snapshot is read through toOpenWindows off the fake, never hand-built,
// so every shape here is one the pane's real read produces. Without the grant
// the read asks for no groups, as useOpenWindows does.
async function snapshot(hasTabGroups: boolean): Promise<OpenWindow[]> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups =
    hasTabGroups && chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

async function install(seed: ChromeSeed, hasTabGroups = true) {
  handle = setupChromeFake(seed);
  return snapshot(hasTabGroups);
}

function renderDrop(
  windows: readonly OpenWindow[],
  options: {
    hasTabGroups?: boolean;
    collapsedIds?: ReadonlySet<number>;
  } = {}
) {
  const { store, wrapper } = storeWrapper();
  const rendered = renderHook(
    () =>
      useOpenNowDrop({
        windows,
        hasTabGroups: options.hasTabGroups ?? true,
        collapsedIds: options.collapsedIds ?? new Set(),
      }),
    { wrapper }
  );
  return { ...rendered, store };
}

// W1: two pinned tabs, then two unpinned. W2: a loose tab and group 50 (two
// tabs), no pinned tab. W3: every tab pinned. W4: incognito.
const PINNED_A = 11;
const PINNED_B = 12;
const LOOSE_A = 13;
const LOOSE_B = 14;
const LOOSE_C = 21;
const GROUPED_1 = 22;
const GROUPED_2 = 23;
const ALL_PINNED_1 = 31;
const ALL_PINNED_2 = 32;
const INCOGNITO_TAB = 41;
const GROUP = 50;

function fourWindows(extra: Partial<ChromeSeed> = {}): ChromeSeed {
  return {
    windows: [
      {
        id: 1,
        tabs: [
          { id: PINNED_A, url: url('pa'), pinned: true, active: true },
          { id: PINNED_B, url: url('pb'), pinned: true },
          { id: LOOSE_A, url: url('la') },
          { id: LOOSE_B, url: url('lb') },
        ],
      },
      {
        id: 2,
        tabs: [
          { id: LOOSE_C, url: url('lc'), active: true },
          { id: GROUPED_1, url: url('g1'), groupId: GROUP },
          { id: GROUPED_2, url: url('g2'), groupId: GROUP },
        ],
      },
      {
        id: 3,
        tabs: [
          { id: ALL_PINNED_1, url: url('ap1'), pinned: true, active: true },
          { id: ALL_PINNED_2, url: url('ap2'), pinned: true },
        ],
      },
      {
        id: 4,
        incognito: true,
        tabs: [{ id: INCOGNITO_TAB, url: url('in'), active: true }],
      },
    ],
    tabGroups: [{ id: GROUP, title: 'Research', color: 'blue', windowId: 2 }],
    ...extra,
  };
}

const groupItem = `group:${GROUP}`;

describe('openDragWindows: the windows as the drop geometry reads them', () => {
  const seed = (): ChromeSeed => ({
    windows: [
      {
        id: 7,
        tabs: [
          { id: 71, url: url('p'), pinned: true },
          { id: 72, url: url('g1'), groupId: GROUP },
          { id: 73, url: url('g2'), groupId: GROUP },
          { id: 74, url: url('l') },
        ],
      },
    ],
    tabGroups: [{ id: GROUP, title: 'Research', color: 'blue', windowId: 7 }],
  });

  test('ids become strings, pinned is carried, and a grouped tab names its group', async () => {
    const windows = await install(seed());
    expect(openDragWindows(windows, true)).toEqual([
      {
        windowId: '7',
        tabs: [
          { tabId: '71', pinned: true },
          { tabId: '72', pinned: false, chromeGroupId: '50' },
          { tabId: '73', pinned: false, chromeGroupId: '50' },
          { tabId: '74', pinned: false },
        ],
        chromeTabGroups: [{ groupId: '50', title: 'Research', color: 'blue' }],
      },
    ]);
  });

  test('without the grant there are no groups (O11e)', async () => {
    const windows = await install(seed(), false);
    expect(openDragWindows(windows, false)).toEqual([
      {
        windowId: '7',
        tabs: [
          { tabId: '71', pinned: true },
          { tabId: '72', pinned: false },
          { tabId: '73', pinned: false },
          { tabId: '74', pinned: false },
        ],
        chromeTabGroups: [],
      },
    ]);
  });

  // Off the happy path: a snapshot read while the grant was held, handed over
  // after it went. The geometry must not offer bands the pane stops drawing.
  test('a snapshot that still carries groups loses them when the grant is gone', async () => {
    const windows = await install(seed());
    const [window] = openDragWindows(windows, false);
    expect(window?.chromeTabGroups).toEqual([]);
    expect(window?.tabs.some((tab) => tab.chromeGroupId !== undefined)).toBe(
      false
    );
  });
});

describe('landingRange: where a held row may land in a window (O11c)', () => {
  // KAN-814. The slot decides a tab's pin, so a tab may land on any row, in
  // its own window and another.
  test('a tab lands anywhere, in its own window and another, pinned or not', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    // W1 with LOOSE_A lifted out: [PA, PB, LB].
    expect(result.current.tabs.landingRange(String(LOOSE_A), '1')).toEqual({
      min: 0,
      max: 3,
    });
    // W1 with PINNED_A lifted out: [PB, LA, LB].
    expect(result.current.tabs.landingRange(String(PINNED_A), '1')).toEqual({
      min: 0,
      max: 3,
    });
    // Into W1 from W2: [PA, PB, LA, LB].
    expect(result.current.tabs.landingRange(String(LOOSE_C), '1')).toEqual({
      min: 0,
      max: 4,
    });
    // A pinned tab into W2, which has no pinned run: [LC, G1, G2].
    expect(result.current.tabs.landingRange(String(PINNED_A), '2')).toEqual({
      min: 0,
      max: 3,
    });
    // An unpinned tab into W3, every tab of which is pinned: [AP1, AP2].
    expect(result.current.tabs.landingRange(String(LOOSE_A), '3')).toEqual({
      min: 0,
      max: 2,
    });
  });

  test('a group lands below the pinned run, counted in top-level rows', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    // W1's items: PA, PB, LA, LB.
    expect(result.current.items.landingRange(groupItem, '1')).toEqual({
      min: 2,
      max: 4,
    });
    // Its own W2 with the group lifted out: [LC].
    expect(result.current.items.landingRange(groupItem, '2')).toEqual({
      min: 0,
      max: 1,
    });
    expect(result.current.items.landingRange(groupItem, '3')).toEqual({
      min: 2,
      max: 2,
    });
  });

  // Task 5's fix round: the engine bounds the range to the rows a window
  // SHOWS, and a folded window shows none -- it takes only position 0. A min
  // read from Chrome's pinned count there would refuse every drop.
  test('a folded window shows no rows, so it takes position 0 whatever it holds', async () => {
    const { result } = renderDrop(await install(fourWindows()), {
      collapsedIds: new Set([1, 3]),
    });
    expect(result.current.tabs.landingRange(String(LOOSE_C), '1')).toEqual({
      min: 0,
      max: 0,
    });
    expect(result.current.tabs.landingRange(String(LOOSE_C), '3')).toEqual({
      min: 0,
      max: 0,
    });
    expect(result.current.items.landingRange(groupItem, '1')).toEqual({
      min: 0,
      max: 0,
    });
  });
});

describe('acceptsWindow: which windows take a held row at all', () => {
  // T1 (spec O11h). The page this pane is on is left out of the list, but it
  // can sit in a Chrome group -- here, group 50, between LC and G1.
  const tabViewInGroup = (): ChromeSeed => {
    const seed = fourWindows({ currentTabId: 20 });
    seed.windows?.[1]?.tabs?.splice(1, 0, {
      id: 20,
      url: tabViewUrl(),
      groupId: GROUP,
    });
    return seed;
  };

  // KAN-814 K-B, replacing K1: the slot decides the pin in another window too.
  test('a pinned tab may go to another window of its profile', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(result.current.tabs.acceptsWindow(String(PINNED_A), '2')).toBe(true);
    expect(result.current.tabs.acceptsWindow(String(PINNED_A), '3')).toBe(true);
    // O11d still holds.
    expect(result.current.tabs.acceptsWindow(String(PINNED_A), '4')).toBe(
      false
    );
  });

  test('T1: a group holding this page stays in its own window', async () => {
    const { result } = renderDrop(await install(tabViewInGroup()));
    await waitFor(() =>
      expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(false)
    );
    expect(result.current.items.acceptsWindow(groupItem, '2')).toBe(true);
    // Only the group: a tab of it may still leave on its own.
    expect(result.current.tabs.acceptsWindow(String(GROUPED_1), '1')).toBe(
      true
    );
  });

  test('T1: in the popup there is no page tab, and the group may leave', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(true);
  });

  // The page's group is read again with each snapshot: it can be grouped
  // after the pane opened.
  test('T1: the page joining the group later is seen at the next snapshot', async () => {
    const seed = fourWindows({ currentTabId: 20 });
    seed.windows?.[1]?.tabs?.push({ id: 20, url: tabViewUrl() });
    const first = await install(seed);
    const { wrapper } = storeWrapper();
    const { result, rerender } = renderHook(
      ({ windows }: { windows: readonly OpenWindow[] }) =>
        useOpenNowDrop({
          windows,
          hasTabGroups: true,
          collapsedIds: new Set(),
        }),
      { initialProps: { windows: first }, wrapper }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(true);
    await chrome.tabs.group({ groupId: GROUP, tabIds: [20] });
    rerender({ windows: await snapshot(true) });
    await waitFor(() =>
      expect(result.current.items.acceptsWindow(groupItem, '1')).toBe(false)
    );
  });
});

describe('a drop becomes Chrome calls, or none', () => {
  // Task 4's refusal paths, each of which Open now's callers can reach: the
  // geometry describes no move, and nothing is asked of Chrome.
  test('a tab the snapshot does not hold calls nothing', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(await result.current.tabs.onMove('999', 0, undefined, '1')).toBe(
      null
    );
    expect(moveOpenTab).not.toHaveBeenCalled();
  });

  test('a tab drop that names no window calls nothing', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(
      await result.current.tabs.onMove(String(LOOSE_A), 0, undefined, undefined)
    ).toBe(null);
    expect(moveOpenTab).not.toHaveBeenCalled();
  });

  // Chrome numbers tabs and groups separately, so a tab can carry the same
  // number as a group: its item id must still not be read as that group.
  test('a loose tab’s item id in the group list calls nothing, even when a group shares its number', async () => {
    const seed = fourWindows();
    seed.windows?.[0]?.tabs?.push({ id: GROUP, url: url('same-number') });
    const { result } = renderDrop(await install(seed));
    expect(
      await result.current.items.onMove(`tab:${GROUP}`, 0, undefined, '1')
    ).toBe(null);
    expect(
      await result.current.items.onMove(`tab:${LOOSE_A}`, 0, undefined, '2')
    ).toBe(null);
    expect(moveOpenGroup).not.toHaveBeenCalled();
    expect(moveOpenTab).not.toHaveBeenCalled();
  });

  test('a group no window holds, or a group drop that names no window, calls nothing', async () => {
    const { result } = renderDrop(await install(fourWindows()));
    expect(
      await result.current.items.onMove('group:77', 0, undefined, '1')
    ).toBe(null);
    expect(
      await result.current.items.onMove(groupItem, 0, undefined, undefined)
    ).toBe(null);
    expect(moveOpenGroup).not.toHaveBeenCalled();
  });

  // Off the happy path: Chrome refuses (the tab closed during the hold). The
  // hook passes the refusal on as null and keeps nothing for ⌘Z.
  test('a move Chrome refuses leaves nothing to undo', async () => {
    const windows = await install(fourWindows());
    const { result, store } = renderDrop(windows);
    await chrome.tabs.remove(LOOSE_A);
    expect(
      await result.current.tabs.onMove(String(LOOSE_A), 0, undefined, '2')
    ).toBe(null);
    expect(moveOpenTab).toHaveBeenCalled();
    expect(store.getState().undoRedo.past).toEqual([]);
  });

  // KAN-744 R19. A drag becomes its step only once Chrome's move lands; a press before that is ignored.
  test('⌘Z while a drop is still moving is busy and leaves the saved step below it', async () => {
    const { result, store } = renderDrop(await install(fourWindows()));
    store.dispatch(
      setPresentStartup({
        tabContainerDataState: store.getState().tabContainerDataState,
      })
    );
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: 's', title: 'S' }))
    );
    const original: (
      id: number,
      props: chrome.tabs.MoveProperties
    ) => Promise<chrome.tabs.Tab> = chrome.tabs.move;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const move = vi
      .spyOn(chrome.tabs, 'move')
      .mockImplementation((id, props) =>
        gate.then(() =>
          typeof id === 'number'
            ? original(id, props)
            : Promise.reject(new Error('PREMISE: one tab moves at a time'))
        )
      );
    const saved = () =>
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
    // PREMISE: one saved step to undo.
    expect(saved()).toEqual(['s']);
    expect(store.getState().undoRedo.past).toHaveLength(1);

    const dropping = result.current.tabs.onMove(
      String(LOOSE_A),
      0,
      undefined,
      '2'
    );
    await waitFor(() => expect(move).toHaveBeenCalled());

    expect(await store.dispatch(undoStep()).unwrap()).toBe('busy');
    expect(saved()).toEqual(['s']);
    expect(store.getState().undoRedo.past).toHaveLength(1);

    release();
    expect(await dropping).not.toBe(null);
    move.mockRestore();

    expect(selectLiveStepOnTop(store.getState())?.drop.kind).toBe('tab');
    expect(store.getState().undoRedo.past).toHaveLength(2);
  });

  // KAN-744 R1. A drop that moved something is the newest step in the history.
  test.each([
    ['tab', 'tabs', String(LOOSE_A), 0, '2'],
    ['group', 'items', groupItem, 0, '2'],
  ] as const)(
    'a %s drop that moved joins the undo history',
    async (kind, list, rowId, toIndex, toWindowId) => {
      const { result, store } = renderDrop(await install(fourWindows()));

      expect(
        await result.current[list].onMove(rowId, toIndex, undefined, toWindowId)
      ).not.toBe(null);

      expect(selectLiveStepOnTop(store.getState())?.drop.kind).toBe(kind);
      expect(store.getState().undoRedo.past).toHaveLength(1);
    }
  );
});

// KAN-814. The slot decides the pin (moveOpenTab); the hook says so with
// KAN-811's toast, whose Undo is the drop's own step (KAN-744 R16).
describe('a drop that pins or unpins a tab says so', () => {
  const tabNow = async (id: number) => {
    const tab = await chrome.tabs.get(id);
    return { windowId: tab.windowId, index: tab.index, pinned: tab.pinned };
  };
  const toasts = (store: ReturnType<typeof renderDrop>['store']) =>
    store.getState().globalState.toasts.map((t) => ({
      text: t.text,
      liveStepId: t.liveStepId,
    }));
  const topId = (store: ReturnType<typeof renderDrop>['store']) =>
    selectLiveStepOnTop(store.getState())?.id;

  test('into the pinned run: pinned, "Tab pinned." with Undo for that step', async () => {
    const { result, store } = renderDrop(await install(fourWindows()));
    expect(
      await result.current.tabs.onMove(String(LOOSE_A), 0, undefined, '1')
    ).not.toBe(null);
    expect(await tabNow(LOOSE_A)).toEqual({
      windowId: 1,
      index: 0,
      pinned: true,
    });
    expect(topId(store)).toBeDefined();
    expect(toasts(store)).toEqual([
      { text: TOAST_MESSAGES.TAB_PINNED, liveStepId: topId(store) },
    ]);
  });

  test('below the pinned run: unpinned, "Tab unpinned."', async () => {
    const { result, store } = renderDrop(await install(fourWindows()));
    // W1 with PINNED_A lifted out: [PB, LA, LB]; 3 is the end.
    await result.current.tabs.onMove(String(PINNED_A), 3, undefined, '1');
    expect(await tabNow(PINNED_A)).toEqual({
      windowId: 1,
      index: 3,
      pinned: false,
    });
    expect(toasts(store)).toEqual([
      { text: TOAST_MESSAGES.TAB_UNPINNED, liveStepId: topId(store) },
    ]);
  });

  // K-B: a pinned tab may leave its window; the slot there decides. One drop
  // per snapshot: a second would be refused as stale (ledger R3).
  test('into another window’s pinned run: still pinned, and nothing is told', async () => {
    const { result, store } = renderDrop(await install(fourWindows()));
    // W3's run is [AP1, AP2]: 1 is inside it.
    await result.current.tabs.onMove(String(PINNED_A), 1, undefined, '3');
    expect(await tabNow(PINNED_A)).toEqual({
      windowId: 3,
      index: 1,
      pinned: true,
    });
    expect(toasts(store)).toEqual([]);
  });

  test('into another window with no pinned run: unpinned, "Tab unpinned."', async () => {
    const { result, store } = renderDrop(await install(fourWindows()));
    // W2 is [LC, G1, G2]: 0 is the boundary of an empty run, which keeps a
    // pin, so 1 is below it.
    await result.current.tabs.onMove(String(PINNED_B), 1, undefined, '2');
    expect(await tabNow(PINNED_B)).toEqual({
      windowId: 2,
      index: 1,
      pinned: false,
    });
    expect(toasts(store)).toEqual([
      { text: TOAST_MESSAGES.TAB_UNPINNED, liveStepId: topId(store) },
    ]);
  });

  test('a move that keeps the pin is a step, told by no toast', async () => {
    const { result, store } = renderDrop(await install(fourWindows()));
    await result.current.tabs.onMove(String(LOOSE_A), 3, undefined, '1');
    expect(await tabNow(LOOSE_A)).toEqual({
      windowId: 1,
      index: 3,
      pinned: false,
    });
    expect(topId(store)).toBeDefined();
    expect(toasts(store)).toEqual([]);
  });

  // My call, told in the PR: a folded window shows no slot, so nothing chose a
  // pin there. The engine names position 0; the hook keeps the tab's pin.
  test.each([
    ['an unpinned tab lands below the run', LOOSE_C, 1, 2, false],
    ['a pinned tab lands at the front of the run', ALL_PINNED_1, 1, 0, true],
    ['a pinned tab, no run there, keeps its pin', ALL_PINNED_1, 2, 0, true],
  ] as const)(
    'a drop on a folded window keeps the tab’s pin: %s',
    async (_name, tabId, toWindowId, index, pinned) => {
      const { result, store } = renderDrop(await install(fourWindows()), {
        collapsedIds: new Set([toWindowId]),
      });
      await result.current.tabs.onMove(
        String(tabId),
        0,
        undefined,
        String(toWindowId)
      );
      expect(await tabNow(tabId)).toEqual({
        windowId: toWindowId,
        index,
        pinned,
      });
      expect(toasts(store)).toEqual([]);
    }
  );

  test('undoing the drop puts the pin back', async () => {
    const { result, store } = renderDrop(await install(fourWindows()));
    await result.current.tabs.onMove(String(LOOSE_A), 0, undefined, '1');
    // PREMISE: the drop pinned it.
    expect((await tabNow(LOOSE_A)).pinned).toBe(true);
    expect(await store.dispatch(undoStep()).unwrap()).not.toBe('busy');
    expect(await tabNow(LOOSE_A)).toEqual({
      windowId: 1,
      index: 2,
      pinned: false,
    });
  });
});
