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
  moveTabAcrossWindowsInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// The same trap KAN-107 and the Chrome group actions hit: an action missing
// from actionsToCapture still renders and still reaches localStorage, so it
// looks correct everywhere except the two places that matter -- it loses its
// undo step, and it never dirties the container, so the move is never
// synced. Asserted as those two consequences rather than as membership of a
// list, because the list is the implementation of the rule, not the rule.

const build = () => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-12 00:00:00',
  windowCount: 2,
  tabCount: 4,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'wA',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'A',
      tabs: [
        { tabId: 'a0', favicon: '', title: 'A0', url: 'https://a0.co' },
        {
          tabId: 'a1',
          favicon: '',
          title: 'A1',
          url: 'https://a1.co',
          chromeGroupId: 'grp',
        },
      ],
      chromeTabGroups: [{ groupId: 'grp', title: 'Research', color: 'blue' }],
    },
    {
      windowId: 'wB',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'B',
      tabs: [
        { tabId: 'b0', favicon: '', title: 'B0', url: 'https://b0.co' },
        { tabId: 'b1', favicon: '', title: 'B1', url: 'https://b1.co' },
      ],
      chromeTabGroups: [],
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
const idsOf = (s: Store, windowId: string) =>
  s
    .getState()
    .tabContainerDataState.tabGroups[0].windows.find(
      (w) => w.windowId === windowId
    )!
    .tabs.map((t) => t.tabId);

describe('moving a tab across windows is a captured action', () => {
  test('a cross-window move is undoable and dirties the container', () => {
    const store = seeded();
    store.dispatch(
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 0,
      })
    );
    expect(idsOf(store, 'wA')).toEqual(['a1']);
    expect(idsOf(store, 'wB')).toEqual(['a0', 'b0', 'b1']);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(idsOf(store, 'wA')).toEqual(['a0', 'a1']);
    expect(idsOf(store, 'wB')).toEqual(['b0', 'b1']);
  });

  test('a move that changes group membership is undoable', () => {
    const store = seeded();
    store.dispatch(
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 0,
        toChromeGroupId: 'destGroup',
      })
    );
    const groupOf = (s: Store) =>
      s
        .getState()
        .tabContainerDataState.tabGroups[0].windows.find(
          (w) => w.windowId === 'wB'
        )
        ?.tabs.find((t) => t.tabId === 'a0')?.chromeGroupId;
    expect(groupOf(store)).toBe('destGroup');

    store.dispatch(undo());
    expect(groupOf(store)).toBeUndefined();
  });

  // THE CONTROL. Both assertions above would also pass if the middleware
  // captured every action indiscriminately. A move aimed at a tab that is not
  // there changes nothing, so it must not become an undo step or dirty the
  // container.
  test('CONTROL: a move of an unknown tab neither dirties nor pushes undo', () => {
    const store = seeded();
    const pastBefore = store.getState().undoRedo.past.length;

    store.dispatch(
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'nope',
        toIndex: 0,
      })
    );

    expect(idsOf(store, 'wA')).toEqual(['a0', 'a1']);
    expect(idsOf(store, 'wB')).toEqual(['b0', 'b1']);
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(pastBefore);
  });
});
