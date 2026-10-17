import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-666. Chrome sometimes never fires the storage event for another page's
// write. This page's next save must not write over what it never heard.

const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);
const MIN = 60_000;

const session = (id: string, at: number): tabContainerData =>
  buildSession({ tabGroupId: id, title: id, createdAt: at, lastModified: at });

const container = (
  sessions: tabContainerData[],
  extra: Partial<TabMasterContainer> = {}
): TabMasterContainer => ({
  ...buildContainer(sessions),
  lastModified: Math.max(...sessions.map((s) => s.lastModified ?? 0)),
  ...extra,
});

// Another page's write, with no storage event here.
const otherPageWritesUnheard = (value: TabMasterContainer) =>
  localStorage.setItem('tabContainerData', JSON.stringify(value));

const stored = (): TabMasterContainer =>
  JSON.parse(localStorage.getItem('tabContainerData') ?? 'null');

// Sorted: the sort setting reorders the list after an edit; what is kept is the point.
const storedIds = () =>
  stored()
    .tabGroups.map((g) => g.tabGroupId)
    .sort();

const storedTitle = (id: string) =>
  stored().tabGroups.find((g) => g.tabGroupId === id)?.title;

type Store = ReturnType<typeof makeTestStore>['store'];
const shownIds = (store: Store) =>
  store
    .getState()
    .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    .sort();

const shownTitle = (store: Store, id: string) =>
  store
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id)?.title;

const rename = (tabGroupId: string, title: string) =>
  updateTabGroupTitle({ tabGroupId, editableTitle: title });

// A page holding a and b, as it loaded them.
function pageWithAB() {
  vi.setSystemTime(T0);
  const { store } = makeTestStore();
  store.dispatch(replaceState(container([session('a', T0), session('b', T0)])));
  // As App's startup load does: undo starts from what was loaded.
  store.dispatch(
    resetHistory({
      tabContainerDataState: store.getState().tabContainerDataState,
    })
  );
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  endDragHold();
  vi.useRealTimers();
});

describe('a write from another page this page never heard (KAN-666)', () => {
  test("this page's next save keeps it, in storage and on screen", () => {
    const store = pageWithAB();
    otherPageWritesUnheard(
      container([session('p', T0 + MIN), session('a', T0), session('b', T0)])
    );

    vi.setSystemTime(T0 + 2 * MIN);
    store.dispatch(rename('b', 'b (edited here)'));

    expect(storedIds()).toEqual(['a', 'b', 'p']);
    expect(storedTitle('b')).toBe('b (edited here)');
    expect(shownIds(store)).toEqual(['a', 'b', 'p']);
  });

  test('a session the other page deleted stays deleted', () => {
    const store = pageWithAB();
    otherPageWritesUnheard(
      container([session('b', T0)], {
        lastModified: T0 + MIN,
        deletedTabGroups: [{ tabGroupId: 'a', deletedAt: T0 + MIN }],
      })
    );

    vi.setSystemTime(T0 + 2 * MIN);
    store.dispatch(rename('b', 'b (edited here)'));

    expect(storedIds()).toEqual(['b']);
    expect(shownIds(store)).toEqual(['b']);
  });

  // D12: undo reverses this page's own steps, never another page's.
  test("undo cannot take the other page's session back out", () => {
    const store = pageWithAB();
    otherPageWritesUnheard(
      container([session('p', T0 + MIN), session('a', T0), session('b', T0)])
    );
    vi.setSystemTime(T0 + 2 * MIN);
    store.dispatch(rename('b', 'b (edited here)'));

    store.dispatch(undo());

    expect(storedIds()).toContain('p');
    expect(shownIds(store)).toContain('p');
  });

  // D12 again: the take-in waits for a held row, but storage keeps it at once.
  test('while a row is held it shows after the release, and storage keeps it at once', () => {
    const store = pageWithAB();
    otherPageWritesUnheard(
      container([session('p', T0 + MIN), session('a', T0), session('b', T0)])
    );
    vi.setSystemTime(T0 + 2 * MIN);
    beginDragHold();

    store.dispatch(rename('b', 'b (edited here)'));

    expect(storedIds()).toEqual(['a', 'b', 'p']);
    expect(shownIds(store)).toEqual(['a', 'b']);
    endDragHold();
    expect(shownIds(store)).toEqual(['a', 'b', 'p']);
  });

  test('unreadable storage is written over, as before', () => {
    const store = pageWithAB();
    localStorage.setItem('tabContainerData', '{not json');

    store.dispatch(rename('b', 'b (edited here)'));

    expect(storedIds()).toEqual(['a', 'b']);
  });
});

describe('a save with no other write in between (KAN-666)', () => {
  test('writes the page as it is and keeps its undo', () => {
    const store = pageWithAB();

    vi.setSystemTime(T0 + MIN);
    store.dispatch(rename('b', 'b (edited here)'));
    expect(storedTitle('b')).toBe('b (edited here)');

    store.dispatch(undo());

    expect(shownTitle(store, 'b')).toBe('b');
    expect(storedTitle('b')).toBe('b');
  });
});
