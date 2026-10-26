import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  type CarriedRef,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import {
  beginDragHold,
  endDragHold,
  whenDragReleases,
} from '../../redux/dragHold';
import { dropCarriedTab } from '../../redux/dropCarried';
import { dropSavedTab } from '../../redux/pinChangeToast';
import { undoStep } from '../../redux/undoHistory';
import { NEW_FIRST_WINDOW } from '../../components/home/rightpane/newWindowTarget';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  T0,
  container,
  group,
  session,
  tab,
  windowIn,
  win,
} from '../fixtures/sessionMoveFixture';

// KAN-811. A drop that changes a saved tab's pin says so, with Undo; a drop that keeps it says nothing.
// S1: w1 [p1*, p2*, t1, t2, b1*g, b2*g], w2 [t3]. S2: d1 [q1*, u1, t1] -- q1 pinned, so p1 dropped after it can keep or lose its pin;
// S2's t1 shares S1's id, so carried into S1 it is re-minted.

type Store = ReturnType<typeof makeTestStore>['store'];

const pin = (t: tabData): tabData => ({ ...t, pinned: true });
const pinned = () =>
  container(
    [
      session('S2', 'Target', T0 - 7_200_000, [
        win('d1', [pin(tab('q1')), tab('u1'), tab('t1')]),
      ]),
      session('S1', 'Source', T0 - 10_800_000, [
        win(
          'w1',
          [
            pin(tab('p1')),
            pin(tab('p2')),
            tab('t1'),
            tab('t2'),
            tab('b1', 'g'),
            tab('b2', 'g'),
          ],
          [group('g')]
        ),
        win('w2', [tab('t3')]),
      ]),
    ],
    'S1'
  );

const ready = () => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(pinned()));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made.store;
};

const toasts = (store: Store) =>
  store
    .getState()
    .globalState.toasts.map(({ text, offersUndo }) => ({ text, offersUndo }));
const pinOf = (store: Store, tabGroupId: string, windowId: string) =>
  windowIn(
    store.getState().tabContainerDataState,
    tabGroupId,
    windowId
  ).tabs.map((t) => `${t.tabId}${t.pinned === true ? '*' : ''}`);

const drop = (
  store: Store,
  tabId: string,
  toIndex: number,
  {
    fromWindowId = 'w1',
    toWindowId = 'w1',
    toChromeGroupId = undefined as string | undefined,
  } = {}
) =>
  store.dispatch(
    dropSavedTab({
      tabGroupId: 'S1',
      tabId,
      fromWindowId,
      toWindowId,
      toIndex,
      toChromeGroupId,
    })
  );

const PINNED = { text: TOAST_MESSAGES.TAB_PINNED, offersUndo: true };
const UNPINNED = { text: TOAST_MESSAGES.TAB_UNPINNED, offersUndo: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  endDragHold();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('a saved tab dropped in its own session', () => {
  it('into the pinned run: "Tab pinned." with Undo', () => {
    const store = ready();
    drop(store, 't1', 0);
    expect(pinOf(store, 'S1', 'w1')).toEqual([
      't1*',
      'p1*',
      'p2*',
      't2',
      'b1',
      'b2',
    ]);
    expect(toasts(store)).toEqual([PINNED]);
  });

  it('below the pinned run: "Tab unpinned." with Undo', () => {
    const store = ready();
    drop(store, 'p1', 3);
    expect(pinOf(store, 'S1', 'w1')).toEqual([
      'p2*',
      't1',
      't2',
      'p1',
      'b1',
      'b2',
    ]);
    expect(toasts(store)).toEqual([UNPINNED]);
  });

  it('into a group: "Tab unpinned."', () => {
    const store = ready();
    drop(store, 'p1', 4, { toChromeGroupId: 'g' });
    expect(pinOf(store, 'S1', 'w1')).toEqual([
      'p2*',
      't1',
      't2',
      'b1',
      'p1',
      'b2',
    ]);
    expect(toasts(store)).toEqual([UNPINNED]);
  });

  it('from another window into the pinned run: "Tab pinned."', () => {
    const store = ready();
    drop(store, 't3', 0, { fromWindowId: 'w2' });
    expect(pinOf(store, 'S1', 'w1')[0]).toBe('t3*');
    expect(toasts(store)).toEqual([PINNED]);
  });

  it.each([
    ['within the unpinned tabs', 't2', 2],
    ['within the pinned run', 'p2', 0],
    ['put back at the edge of the pinned run', 'p2', 1],
  ])('%s: no toast', (_, tabId, toIndex) => {
    const store = ready();
    drop(store, tabId, toIndex);
    expect(toasts(store)).toEqual([]);
  });

  it('Undo puts the pin back and closes the toast', async () => {
    const store = ready();
    drop(store, 't1', 0);
    await store.dispatch(undoStep());
    expect(pinOf(store, 'S1', 'w1')).toEqual([
      'p1*',
      'p2*',
      't1',
      't2',
      'b1',
      'b2',
    ]);
    expect(toasts(store)).toEqual([]);
  });
});

describe('a carried saved tab', () => {
  const P1: Extract<CarriedRef, { kind: 'tab' }> = {
    kind: 'tab',
    tabGroupId: 'S1',
    windowId: 'w1',
    tabId: 'p1',
  };

  it('into its own session, below the pinned run: "Tab unpinned."', () => {
    const store = ready();
    store.dispatch(
      dropCarriedTab(P1, { tabGroupId: 'S1', toWindowId: 'w1', toIndex: 3 })
    );
    expect(toasts(store)).toEqual([UNPINNED]);
  });

  it('into another session, below its pinned run: "Tab unpinned."', () => {
    const store = ready();
    store.dispatch(
      dropCarriedTab(P1, { tabGroupId: 'S2', toWindowId: 'd1', toIndex: 2 })
    );
    expect(pinOf(store, 'S2', 'd1')).toEqual(['q1*', 'u1', 'p1', 't1']);
    expect(toasts(store)).toEqual([UNPINNED]);
  });

  it('from another session whose id this one holds: re-minted, still "Tab pinned."', () => {
    const store = ready();
    store.dispatch(
      dropCarriedTab(
        { kind: 'tab', tabGroupId: 'S2', windowId: 'd1', tabId: 't1' },
        { tabGroupId: 'S1', toWindowId: 'w1', toIndex: 0 }
      )
    );
    const [landed] = pinOf(store, 'S1', 'w1');
    // PREMISE: the carried tab got a new id, so it can't be found by its old one.
    expect(landed).not.toBe('t1*');
    expect(landed.endsWith('*')).toBe(true);
    expect(toasts(store)).toEqual([PINNED]);
  });

  it('into another session, after its pinned run, keeping its pin: no toast', () => {
    const store = ready();
    store.dispatch(
      dropCarriedTab(P1, { tabGroupId: 'S2', toWindowId: 'd1', toIndex: 1 })
    );
    expect(pinOf(store, 'S2', 'd1')).toEqual(['q1*', 'p1*', 'u1', 't1']);
    expect(toasts(store)).toEqual([]);
  });

  it('as a new window: keeps its pin, no toast', () => {
    const store = ready();
    store.dispatch(
      dropCarriedTab(P1, {
        tabGroupId: 'S2',
        toWindowId: NEW_FIRST_WINDOW,
        toIndex: 0,
      })
    );
    expect(toasts(store)).toEqual([]);
  });
});

// Another page's tab arrives in the landing window while the row is held, and is applied at the drop, before it (dropOnTop).
describe('a change from another page landing with the drop', () => {
  const arrivesWithTheDrop = (
    store: Store,
    tabGroupId: string,
    windowId: string
  ) => {
    beginDragHold();
    whenDragReleases(() => {
      const c = structuredClone(store.getState().tabContainerDataState);
      windowIn(c, tabGroupId, windowId).tabs.push(tab('n1'));
      store.dispatch(replaceState(c));
    });
  };

  it('in its own session: found by its id, "Tab pinned."', () => {
    const store = ready();
    arrivesWithTheDrop(store, 'S1', 'w1');
    drop(store, 't3', 0, { fromWindowId: 'w2' });
    // PREMISE: two ids are new to w1.
    expect(pinOf(store, 'S1', 'w1')).toEqual([
      't3*',
      'p1*',
      'p2*',
      't1',
      't2',
      'b1',
      'b2',
      'n1',
    ]);
    expect(toasts(store)).toEqual([PINNED]);
  });

  it('into another session, keeping its id: found by it, "Tab unpinned."', () => {
    const store = ready();
    arrivesWithTheDrop(store, 'S2', 'd1');
    store.dispatch(
      dropCarriedTab(
        { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'p1' },
        { tabGroupId: 'S2', toWindowId: 'd1', toIndex: 2 }
      )
    );
    expect(pinOf(store, 'S2', 'd1')).toEqual(['q1*', 'u1', 'p1', 't1', 'n1']);
    expect(toasts(store)).toEqual([UNPINNED]);
  });

  it('into another session, re-minted: two new ids name no tab, no toast', () => {
    const store = ready();
    arrivesWithTheDrop(store, 'S1', 'w1');
    store.dispatch(
      dropCarriedTab(
        { kind: 'tab', tabGroupId: 'S2', windowId: 'd1', tabId: 't1' },
        { tabGroupId: 'S1', toWindowId: 'w1', toIndex: 0 }
      )
    );
    // PREMISE: it landed pinned, so a toast that guessed would say "Tab pinned.".
    expect(pinOf(store, 'S1', 'w1')[0]).toMatch(/\*$/);
    expect(toasts(store)).toEqual([]);
  });
});
