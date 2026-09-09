import { describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  saveToTabContainerInternal,
  moveSessionInternal,
  clearSessionOrder,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// KAN-130. A session's position becomes real, stored, syncable order.
//
// TWO THINGS MUST AGREE, and that is the crux of this reducer. The stored array
// order IS the display order -- selectVisibleTabGroups filters but never sorts
// -- so a drag has to splice the array to be visible at all. The merge, though,
// re-derives order on every sync from `rank ?? createdInstant`. So the reducer
// writes both, and the invariant is that sorting the result by rankOf
// reproduces the array it just built. A reducer that set only the rank would
// appear to do nothing until the next sync; one that set only the array would
// be undone BY the next sync.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

// Created an hour apart, newest first -- which is the order the app maintains.
const build = (id: string, createdAt: number) => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-09-09 12:00:00',
  createdAt,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window',
      tabs: [
        { tabId: `${id}-t`, favicon: '', title: 'Tab', url: 'https://a.co' },
      ],
    },
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];

// Seeded oldest-first through saveToTabContainerInternal, which unshifts -- so
// the resulting array is newest-first: c, b, a.
const seeded = () => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(build('a', T0 - 2 * HOUR)));
  store.dispatch(saveToTabContainerInternal(build('b', T0 - HOUR)));
  store.dispatch(saveToTabContainerInternal(build('c', T0)));
  store.dispatch(setIsNotDirty());
  return store;
};

const ids = (s: Store) =>
  s.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
const groupOf = (s: Store, id: string) =>
  s
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id)!;
const rankOf = (s: Store, id: string) => {
  const g = groupOf(s, id);
  return g.rank ?? g.createdAt!;
};

describe('the seeded list', () => {
  test('is newest-first and carries no ranks', () => {
    const store = seeded();
    expect(ids(store)).toEqual(['c', 'b', 'a']);
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.every((g) => g.rank === undefined)
    ).toBe(true);
  });
});

describe('moveSessionInternal', () => {
  test('moves a session to the front', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));
    expect(ids(store)).toEqual(['a', 'c', 'b']);
  });

  test('moves a session to the back', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 2 }));
    expect(ids(store)).toEqual(['b', 'a', 'c']);
  });

  test('moves a session into the middle', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 1 }));
    expect(ids(store)).toEqual(['b', 'c', 'a']);
  });

  // Only the dragged session gains a rank. Ranks are SPARSE -- that is what
  // keeps a drag a one-session write rather than a rewrite of the list.
  test('writes a rank on the moved session only', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));

    expect(groupOf(store, 'a').rank).toBeTypeOf('number');
    expect(groupOf(store, 'b').rank).toBeUndefined();
    expect(groupOf(store, 'c').rank).toBeUndefined();
  });

  // THE INVARIANT. Sorting the result by rankOf must reproduce the array the
  // reducer just built, or the next sync silently undoes the drag.
  test('the new rank reproduces the array order when sorted', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 1 }));

    const order = ids(store);
    const bySortKey = [...order].sort(
      (x, y) => rankOf(store, y) - rankOf(store, x)
    );
    expect(bySortKey).toEqual(order);
  });

  test('the invariant holds for a move to the front', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));

    const order = ids(store);
    const bySortKey = [...order].sort(
      (x, y) => rankOf(store, y) - rankOf(store, x)
    );
    expect(bySortKey).toEqual(order);
  });

  test('the invariant holds for a move to the back', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 2 }));

    const order = ids(store);
    const bySortKey = [...order].sort(
      (x, y) => rankOf(store, y) - rankOf(store, x)
    );
    expect(bySortKey).toEqual(order);
  });

  // touch, not stampCreated: createdAt is what rankOf falls back to, so
  // restamping would move the session inside the very list being reordered.
  test('does not restamp createdAt', () => {
    const store = seeded();
    const before = groupOf(store, 'a').createdAt;

    store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));

    expect(groupOf(store, 'a').createdAt).toBe(before);
  });

  test('leaves session contents alone', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));

    const moved = groupOf(store, 'a');
    expect(moved.windowCount).toBe(1);
    expect(moved.tabCount).toBe(1);
    expect(moved.windows[0].tabs[0].tabId).toBe('a-t');
  });
});

describe('moveSessionInternal does nothing when there is nothing to do', () => {
  test('a drop in the same position is not an edit', () => {
    const store = seeded();
    const before = groupOf(store, 'b').lastModified;

    store.dispatch(moveSessionInternal({ tabGroupId: 'b', toIndex: 1 }));

    expect(ids(store)).toEqual(['c', 'b', 'a']);
    expect(groupOf(store, 'b').lastModified).toBe(before);
    expect(groupOf(store, 'b').rank).toBeUndefined();
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  test('an unknown session id changes nothing', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'nope', toIndex: 0 }));

    expect(ids(store)).toEqual(['c', 'b', 'a']);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  test('an out-of-range index clamps rather than throwing', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 99 }));
    expect(ids(store)).toEqual(['b', 'a', 'c']);

    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: -5 }));
    expect(ids(store)).toEqual(['c', 'b', 'a']);
  });
});

// Two sessions saved in the same millisecond have no value between them, so the
// midpoint collapses onto a neighbour. That must renormalise rather than write
// a rank that sorts ambiguously -- an ambiguous rank means two devices can
// disagree about the order, which is the one thing the merge must never allow.
describe('moveSessionInternal when there is no gap to land in', () => {
  const seededSameInstant = () => {
    const { store } = makeTestStore();
    store.dispatch(saveToTabContainerInternal(build('a', T0)));
    store.dispatch(saveToTabContainerInternal(build('b', T0)));
    store.dispatch(saveToTabContainerInternal(build('c', T0)));
    store.dispatch(setIsNotDirty());
    return store;
  };

  test('still lands the session where it was dropped', () => {
    const store = seededSameInstant();
    const before = ids(store);

    store.dispatch(moveSessionInternal({ tabGroupId: before[2], toIndex: 0 }));

    expect(ids(store)[0]).toBe(before[2]);
  });

  test('and leaves an order that survives a re-sort', () => {
    const store = seededSameInstant();
    const before = ids(store);

    store.dispatch(moveSessionInternal({ tabGroupId: before[2], toIndex: 0 }));

    const order = ids(store);
    const bySortKey = [...order].sort(
      (x, y) => rankOf(store, y) - rankOf(store, x)
    );
    expect(bySortKey).toEqual(order);
  });
});

describe('clearSessionOrder', () => {
  test('restores newest-first and drops every rank', () => {
    const store = seeded();
    store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));
    expect(ids(store)).toEqual(['a', 'c', 'b']);

    store.dispatch(clearSessionOrder());

    expect(ids(store)).toEqual(['c', 'b', 'a']);
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.every((g) => g.rank === undefined)
    ).toBe(true);
  });

  // CONTROL. With nothing to clear it must not stamp every session and queue a
  // pointless cloud write.
  test('CONTROL: with no ranks it is not an edit', () => {
    const store = seeded();
    const before = store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.lastModified);

    store.dispatch(clearSessionOrder());

    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((g) => g.lastModified)
    ).toEqual(before);
    expect(store.getState().globalState.isDirty).toBe(false);
  });
});
