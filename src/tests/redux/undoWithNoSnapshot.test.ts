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
  applyUndoSnapshot,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-137. applyUndoSnapshot can be handed nothing to restore.
//
// customMiddleware builds this action as a plain object literal rather than
// through the action creator, so nothing type-checks the payload -- it passes
// `presentState.tabContainerDataState`, which is undefined until `present` has
// been seeded. reconcileAssertedContainer then read `.tabGroups` off undefined
// and threw inside dispatch().
//
// The guard's SHAPE matters as much as its presence: returning the initial
// state instead of the current one would satisfy "does not throw" while
// deleting every session the user has. That is what the second test here is
// for -- removing the guard fails the first, and weakening it to
// `return initialState` fails the second.

const build = (id: string) => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-09-09 12:00:00',
  createdAt: Date.UTC(2026, 8, 9, 12, 0, 0),
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

const seeded = () => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(build('a')));
  store.dispatch(saveToTabContainerInternal(build('b')));
  return store;
};

describe('applyUndoSnapshot with nothing to restore', () => {
  test('does not throw', () => {
    const store = seeded();

    expect(() =>
      store.dispatch(
        applyUndoSnapshot({ snapshot: undefined, withdrawTabGroupIds: [] })
      )
    ).not.toThrow();
  });

  // THE ONE THAT DECIDES THE GUARD'S SHAPE. "Nothing to restore" means leave
  // the container alone -- not reset it. A guard returning initialState would
  // pass every other test in the suite while silently deleting the user's
  // sessions.
  test('leaves every existing session in place', () => {
    const store = seeded();
    const before = store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
    expect(before).toEqual(['b', 'a']);

    store.dispatch(
      applyUndoSnapshot({ snapshot: undefined, withdrawTabGroupIds: [] })
    );

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(before);
  });

  test('and leaves the container timestamp alone', () => {
    const store = seeded();
    const before = store.getState().tabContainerDataState.lastModified;

    store.dispatch(
      applyUndoSnapshot({ snapshot: undefined, withdrawTabGroupIds: [] })
    );

    expect(store.getState().tabContainerDataState.lastModified).toBe(before);
  });
});
