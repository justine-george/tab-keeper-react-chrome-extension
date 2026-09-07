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
  moveTabInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// The same trap KAN-107 and the Chrome group actions hit: an action missing
// from actionsToCapture still renders and still reaches localStorage, so it
// looks correct everywhere except the two places that matter -- it loses its
// undo step, and it never dirties the container, so the reorder is never
// synced. Asserted as those two consequences rather than as membership of a
// list, because the list is the implementation of the rule, not the rule.

const build = () => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-07 00:00:00',
  windowCount: 1,
  tabCount: 3,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'w',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 3,
      title: 'Window',
      tabs: [
        { tabId: 'one', favicon: '', title: 'One', url: 'https://a.co' },
        { tabId: 'two', favicon: '', title: 'Two', url: 'https://b.co' },
        {
          tabId: 'three',
          favicon: '',
          title: 'Three',
          url: 'https://c.co',
          chromeGroupId: 'grp',
        },
      ],
      chromeTabGroups: [{ groupId: 'grp', title: 'Research', color: 'blue' }],
    },
  ],
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
    .tabContainerDataState.tabGroups[0].windows[0].tabs.map((t) => t.tabId);

describe('moving a tab is a captured action', () => {
  test('a reorder is undoable and dirties the container', () => {
    const store = seeded();
    store.dispatch(
      moveTabInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        tabId: 'one',
        toIndex: 2,
      })
    );
    expect(ids(store)).toEqual(['two', 'three', 'one']);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(ids(store)).toEqual(['one', 'two', 'three']);
  });

  test('a move that changes group membership is undoable', () => {
    const store = seeded();
    store.dispatch(
      moveTabInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        tabId: 'one',
        toIndex: 2,
        toChromeGroupId: 'grp',
      })
    );
    const grouped = (s: Store) =>
      s
        .getState()
        .tabContainerDataState.tabGroups[0].windows[0].tabs.find(
          (t) => t.tabId === 'one'
        )?.chromeGroupId;
    expect(grouped(store)).toBe('grp');

    store.dispatch(undo());
    expect(grouped(store)).toBeUndefined();
  });

  // THE CONTROL. Both assertions above would also pass if the middleware
  // captured every action indiscriminately. A move aimed at a tab that is not
  // there changes nothing, so it must not become an undo step or dirty the
  // container.
  test('CONTROL: a move of an unknown tab neither dirties nor pushes undo', () => {
    const store = seeded();
    const pastBefore = store.getState().undoRedo.past.length;

    store.dispatch(
      moveTabInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        tabId: 'nope',
        toIndex: 0,
      })
    );

    expect(ids(store)).toEqual(['one', 'two', 'three']);
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(pastBefore);
  });
});
