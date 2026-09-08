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
  moveWindowInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// The same trap KAN-107, the Chrome group actions and the tab move all hit: an
// action missing from actionsToCapture still renders and still reaches
// localStorage, so it looks correct everywhere except the two places that
// matter -- it loses its undo step, and it never dirties the container, so the
// reorder is never synced. Asserted as those two consequences rather than as
// membership of a list, because the list is the implementation of the rule,
// not the rule.

const win = (id: string, title: string) => ({
  windowId: id,
  windowHeight: 100,
  windowWidth: 100,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title,
  tabs: [
    {
      tabId: `${id}-t0`,
      favicon: '',
      title: `${title} tab`,
      url: 'https://x.co',
    },
  ],
});

const build = () => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-07 00:00:00',
  windowCount: 3,
  tabCount: 3,
  isAutoSave: false,
  isSelected: false,
  windows: [win('w1', 'First'), win('w2', 'Second'), win('w3', 'Third')],
});

type Store = ReturnType<typeof makeTestStore>['store'];

const seeded = () => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(build()));
  store.dispatch(setIsNotDirty());
  return store;
};
const ids = (s: Store) =>
  s
    .getState()
    .tabContainerDataState.tabGroups[0].windows.map((w) => w.windowId);

describe('moving a window is a captured action', () => {
  test('a reorder is undoable and dirties the container', () => {
    const store = seeded();

    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w1', toIndex: 2 })
    );
    expect(ids(store)).toEqual(['w2', 'w3', 'w1']);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(ids(store)).toEqual(['w1', 'w2', 'w3']);
  });

  // THE CONTROL. Both assertions above would also pass if the middleware
  // captured every action indiscriminately. A move aimed at a window that is
  // not there changes nothing, so it must not become an undo step or dirty
  // the container.
  test('CONTROL: a move of an unknown window neither dirties nor pushes undo', () => {
    const store = seeded();
    const pastBefore = store.getState().undoRedo.past.length;

    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'nope', toIndex: 0 })
    );

    expect(ids(store)).toEqual(['w1', 'w2', 'w3']);
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(pastBefore);
  });
});
