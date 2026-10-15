import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load, and showSession reads
// window.location.search. In node, window is made globalThis itself.
const location = vi.hoisted(() => ({ search: '' }));
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
    location,
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
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import { endDragHold } from '../../redux/dragHold';
import { savedItem } from '../../redux/carriedItem';
import {
  carryToNewSession,
  carryToSessionRow,
  carryToSpot,
  carryWindowTo,
} from '../../redux/commitCarry';
import { dropOnSessionRow } from '../../redux/dropOnSessionRow';
import { moveToNewSession } from '../../redux/moveToNewSession';
import {
  dropCarriedGroup,
  dropCarriedTab,
  dropCarriedWindow,
} from '../../redux/dropCarried';
import { T0, container } from '../fixtures/sessionMoveFixture';

// KAN-280 Part F (spec O12c): each router call leaves the store exactly as the KAN-350 move it stands for, from the same start.

// A drop re-reads the stored data first, so each side runs alone: its own store, on a clean localStorage.
const ready = () => {
  localStorage.clear();
  const made = makeTestStore();
  made.store.dispatch(replaceState(container()));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made.store;
};
type Store = ReturnType<typeof ready>;
// Ids the starting data does not hold are random per run (a new window's, a new session's): each reads 'new'.
const known = new Set(
  container().tabGroups.flatMap((g) => [
    g.tabGroupId,
    ...g.windows.map((w) => w.windowId),
  ])
);
const asKnown = (id: string) => (known.has(id) ? id : 'new');
const after = (s: Store) => {
  const data = s.getState().tabContainerDataState;
  return {
    selected:
      data.selectedTabGroupId === null
        ? null
        : asKnown(data.selectedTabGroupId),
    tabGroups: data.tabGroups.map((g) => ({
      ...g,
      tabGroupId: asKnown(g.tabGroupId),
      windows: g.windows.map((w) => ({ ...w, windowId: asKnown(w.windowId) })),
    })),
    toasts: s.getState().globalState.toasts.map((t) => [t.text, t.params]),
  };
};
type Thunk = Parameters<Store['dispatch']>[0];
// One drop from a fresh start: what it returned, and the store after it.
const run = (thunk: () => Thunk) => {
  const store = ready();
  const result = store.dispatch(thunk());
  return { result, after: after(store), store };
};

const TAB: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};
const GROUP: CarriedRef = {
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId: 'g1',
};
const WINDOW: CarriedRef = { kind: 'window', tabGroupId: 'S1', windowId: 'w2' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  location.search = '';
});
afterEach(() => {
  endDragHold();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('commitCarry: a saved item goes to the KAN-350 move', () => {
  it('a session row drop', () => {
    for (const ref of [TAB, GROUP, WINDOW]) {
      const a = run(() => carryToSessionRow(savedItem(ref), 'S2'));
      const b = run(() => dropOnSessionRow(ref, 'S2'));
      expect(a.result).toBe(true);
      expect(a.result).toBe(b.result);
      expect(a.after).toEqual(b.after);
    }
  });

  it('a save row drop', () => {
    const a = run(() =>
      carryToNewSession(savedItem(TAB), 'New Tab Group', 'Typed')
    );
    const b = run(() => moveToNewSession(TAB, 'New Tab Group', 'Typed'));
    expect(a.result).toBe(true);
    expect(a.result).toBe(b.result);
    expect(a.after).toEqual(b.after);
  });

  it('a tab or group at a spot', () => {
    const spot = { tabGroupId: 'S2', toWindowId: 'd1', toIndex: 1 };
    const tabA = run(() => carryToSpot(savedItem(TAB), spot));
    const tabB = run(() =>
      dropCarriedTab(
        { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
        spot
      )
    );
    expect(tabA.result).toBe(true);
    expect(tabA.result).toBe(tabB.result);
    expect(tabA.after).toEqual(tabB.after);

    const groupA = run(() => carryToSpot(savedItem(GROUP), spot));
    const groupB = run(() =>
      dropCarriedGroup(
        { kind: 'group', tabGroupId: 'S1', windowId: 'w1', groupId: 'g1' },
        spot
      )
    );
    expect(groupA.result).toBe(true);
    expect(groupA.result).toBe(groupB.result);
    expect(groupA.after).toEqual(groupB.after);
  });

  it('a window between windows', () => {
    const a = run(() =>
      carryWindowTo(savedItem(WINDOW), { tabGroupId: 'S2', toIndex: 1 })
    );
    const b = run(() =>
      dropCarriedWindow(
        { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
        { tabGroupId: 'S2', toIndex: 1 }
      )
    );
    expect(a.result).toBe(true);
    expect(a.result).toBe(b.result);
    expect(a.after).toEqual(b.after);
  });

  it('refuses a window at a spot inside a window, and a tab between windows, changing nothing', () => {
    const store = ready();
    const before = after(store);
    expect(
      store.dispatch(
        carryToSpot(savedItem(WINDOW), {
          tabGroupId: 'S2',
          toWindowId: 'd1',
          toIndex: 0,
        })
      )
    ).toBe(false);
    expect(
      store.dispatch(
        carryWindowTo(savedItem(TAB), { tabGroupId: 'S2', toIndex: 0 })
      )
    ).toBe(false);
    expect(after(store)).toEqual(before);
  });
});
