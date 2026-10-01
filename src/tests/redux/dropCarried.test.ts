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
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  type CarriedRef,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import { endDragHold } from '../../redux/dragHold';
import { dropOnTop, type DropOnTop } from '../../redux/dropOnTop';
import { groupDrop, tabDrop, windowDrop } from '../../redux/dropSpecs';
import {
  dropCarriedGroup,
  dropCarriedTab,
  dropCarriedWindow,
} from '../../redux/dropCarried';
import { CARRY_NEW_WINDOW_ID } from '../../utils/functions/carriedView';
import {
  T0,
  container,
  sessionIn,
  tabIds,
  windowIds,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-350 Task 5. A carried item let go at an exact spot in the session on
// screen, or on its New window target. Three routes:
//   - the synthetic window (CARRY_NEW_WINDOW_ID): moveToSession, as a new
//     first window;
//   - the session on screen is the item's own: today's tabDrop / groupDrop /
//     windowDrop, from the item's ORIGINAL window, so their no-op guards and
//     prune rules are unchanged (plan Decision);
//   - another session: moveToSession, at that exact spot.
// None sends a Moved toast (S5 A). Each says whether the item moved.
//
// S1: w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3]. S2: d1 [u1, u2*h1,
// u3*h1], d2 [u4].

type Store = ReturnType<typeof makeTestStore>['store'];

const ready = (c: TabMasterContainer = container(undefined, 'S2')) => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made.store;
};

const data = (store: Store) => store.getState().tabContainerDataState;
const toasts = (store: Store) => store.getState().globalState.toasts;

// The result today's builder gives from the same start: what a same-session
// carried drop must equal exactly.
const byBuilder = (drop: DropOnTop) => {
  const store = ready(container(undefined, 'S1'));
  store.dispatch(dropOnTop(drop));
  return data(store);
};

const T1: Extract<CarriedRef, { kind: 'tab' }> = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};
const T2 = { ...T1, tabId: 't2' };
const G1: Extract<CarriedRef, { kind: 'group' }> = {
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId: 'g1',
};
const W2: Extract<CarriedRef, { kind: 'window' }> = {
  kind: 'window',
  tabGroupId: 'S1',
  windowId: 'w2',
};
const W1 = { ...W2, windowId: 'w1' };

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

describe('a carried tab', () => {
  it('into another session, at the exact spot', () => {
    const store = ready();
    const moved = store.dispatch(
      dropCarriedTab(T1, { tabGroupId: 'S2', toWindowId: 'd1', toIndex: 1 })
    );
    expect(moved).toBe(true);
    expect(tabIds(windowIn(data(store), 'S2', 'd1'))).toEqual([
      'u1',
      't1',
      'u2',
      'u3',
    ]);
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).not.toContain('t1');
    expect(toasts(store)).toEqual([]);
  });

  it('into another session, joining the band it was let go in', () => {
    const store = ready();
    store.dispatch(
      dropCarriedTab(T1, {
        tabGroupId: 'S2',
        toWindowId: 'd1',
        toIndex: 2,
        toChromeGroupId: 'h1',
      })
    );
    const d1 = windowIn(data(store), 'S2', 'd1');
    expect(d1.tabs.map((t) => [t.tabId, t.chromeGroupId])).toEqual([
      ['u1', undefined],
      ['u2', 'h1'],
      ['t1', 'h1'],
      ['u3', 'h1'],
    ]);
  });

  it('into its own session: exactly what tabDrop does, from its own window', () => {
    const store = ready(container(undefined, 'S1'));
    const moved = store.dispatch(
      dropCarriedTab(T2, { tabGroupId: 'S1', toWindowId: 'w2', toIndex: 0 })
    );
    expect(moved).toBe(true);
    expect(data(store)).toEqual(
      byBuilder(
        tabDrop({
          tabGroupId: 'S1',
          tabId: 't2',
          fromWindowId: 'w1',
          toWindowId: 'w2',
          toIndex: 0,
        })
      )
    );
    // The premise: it moved.
    expect(tabIds(windowIn(data(store), 'S1', 'w2'))).toEqual(['t2', 't3']);
    expect(toasts(store)).toEqual([]);
  });

  it('into its own window at a new place: exactly what tabDrop does', () => {
    const store = ready(container(undefined, 'S1'));
    store.dispatch(
      dropCarriedTab(T2, { tabGroupId: 'S1', toWindowId: 'w1', toIndex: 0 })
    );
    expect(data(store)).toEqual(
      byBuilder(
        tabDrop({
          tabGroupId: 'S1',
          tabId: 't2',
          fromWindowId: 'w1',
          toWindowId: 'w1',
          toIndex: 0,
        })
      )
    );
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))[0]).toBe('t2');
  });

  it('back where it was: nothing moves, and it says so', () => {
    const store = ready(container(undefined, 'S1'));
    const before = data(store);
    // t2 sits at 3 among w1's other tabs.
    const moved = store.dispatch(
      dropCarriedTab(T2, { tabGroupId: 'S1', toWindowId: 'w1', toIndex: 3 })
    );
    expect(moved).toBe(false);
    expect(data(store)).toBe(before);
  });

  it.each([
    ['another session', 'S2'],
    ['its own session', 'S1'],
  ])('on the New window target in %s: a new first window', (_what, shown) => {
    const store = ready(container(undefined, shown));
    const moved = store.dispatch(
      dropCarriedTab(T1, {
        tabGroupId: shown,
        toWindowId: CARRY_NEW_WINDOW_ID,
        toIndex: 0,
      })
    );
    expect(moved).toBe(true);
    const first = sessionIn(data(store), shown).windows[0];
    expect(tabIds(first)).toEqual(['t1']);
    expect(first.windowId).not.toBe(CARRY_NEW_WINDOW_ID);
    expect(toasts(store)).toEqual([]);
  });
});

describe('a carried group', () => {
  it('into another session, at the exact spot among the items', () => {
    const store = ready();
    const moved = store.dispatch(
      dropCarriedGroup(G1, { tabGroupId: 'S2', toWindowId: 'd2', toIndex: 1 })
    );
    expect(moved).toBe(true);
    expect(tabIds(windowIn(data(store), 'S2', 'd2'))).toEqual([
      'u4',
      'g1a',
      'g1b',
    ]);
    expect(toasts(store)).toEqual([]);
  });

  it('into its own session: exactly what groupDrop does, from its own window', () => {
    const store = ready(container(undefined, 'S1'));
    const moved = store.dispatch(
      dropCarriedGroup(G1, { tabGroupId: 'S1', toWindowId: 'w2', toIndex: 0 })
    );
    expect(moved).toBe(true);
    expect(data(store)).toEqual(
      byBuilder(
        groupDrop({
          tabGroupId: 'S1',
          groupId: 'g1',
          fromWindowId: 'w1',
          toWindowId: 'w2',
          toIndex: 0,
        })
      )
    );
    expect(tabIds(windowIn(data(store), 'S1', 'w2'))).toEqual([
      'g1a',
      'g1b',
      't3',
    ]);
  });

  it('on the New window target: a new first window with its entry', () => {
    const store = ready();
    store.dispatch(
      dropCarriedGroup(G1, {
        tabGroupId: 'S2',
        toWindowId: CARRY_NEW_WINDOW_ID,
        toIndex: 0,
      })
    );
    const first = sessionIn(data(store), 'S2').windows[0];
    expect(tabIds(first)).toEqual(['g1a', 'g1b']);
    expect(first.chromeTabGroups?.map((g) => g.groupId)).toEqual(['g1']);
  });
});

describe('a carried window', () => {
  it('into another session, between its windows', () => {
    const store = ready();
    const moved = store.dispatch(
      dropCarriedWindow(W2, { tabGroupId: 'S2', toIndex: 1 })
    );
    expect(moved).toBe(true);
    expect(windowIds(sessionIn(data(store), 'S2'))).toEqual(['d1', 'w2', 'd2']);
    expect(toasts(store)).toEqual([]);
  });

  it('into its own session: exactly what windowDrop does', () => {
    const store = ready(container(undefined, 'S1'));
    const moved = store.dispatch(
      dropCarriedWindow(W2, { tabGroupId: 'S1', toIndex: 0 })
    );
    expect(moved).toBe(true);
    expect(data(store)).toEqual(byBuilder(windowDrop('S1', 'w2', 0)));
    expect(windowIds(sessionIn(data(store), 'S1'))).toEqual(['w2', 'w1']);
  });

  it('back where it was: nothing moves, and it says so', () => {
    const store = ready(container(undefined, 'S1'));
    const before = data(store);
    const moved = store.dispatch(
      dropCarriedWindow(W1, { tabGroupId: 'S1', toIndex: 0 })
    );
    expect(moved).toBe(false);
    expect(data(store)).toBe(before);
  });
});
