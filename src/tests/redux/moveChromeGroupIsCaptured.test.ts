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
  moveChromeGroupInternal,
  updateWindowGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// The fifth time this trap would bite (KAN-107, the Chrome group actions, the
// tab move and the window move each hit it). An action missing from
// actionsToCapture still renders and still reaches localStorage, but gets no
// undo step and never dirties the container, so it never syncs. Worse, the
// NEXT captured edit snapshots state that already includes it, so undoing
// that edit reverts the move too. Measured on main with MOVE_WINDOW_ACTION
// removed as a stand-in.

const tab = (tabId: string, chromeGroupId?: string) => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

const build = () => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-11 00:00:00',
  windowCount: 2,
  tabCount: 5,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'w',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 4,
      title: 'Grouped',
      tabs: [tab('a0'), tab('g1a', 'alpha'), tab('g1b', 'alpha'), tab('a1')],
      chromeTabGroups: [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }],
    },
    {
      windowId: 'other',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Other',
      tabs: [tab('o0')],
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
const windows = (s: Store) =>
  s.getState().tabContainerDataState.tabGroups[0].windows;
const order = (s: Store) => windows(s)[0].tabs.map((t) => t.tabId);
const moveAlphaToEnd = (s: Store) =>
  s.dispatch(
    moveChromeGroupInternal({
      tabGroupId: 'tg',
      windowId: 'w',
      groupId: 'alpha',
      toIndex: 2,
    })
  );

describe('moving a Chrome group is a captured action', () => {
  test('it dirties the container and is undone in one step', () => {
    const store = seeded();
    moveAlphaToEnd(store);
    expect(order(store)).toEqual(['a0', 'a1', 'g1a', 'g1b']);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(order(store)).toEqual(['a0', 'g1a', 'g1b', 'a1']);
  });

  // THE CASCADE. Only this shows the worse half of the failure.
  test('undoing the NEXT edit leaves the move in place', () => {
    const store = seeded();
    moveAlphaToEnd(store);
    store.dispatch(
      updateWindowGroupTitle({
        tabGroupId: 'tg',
        windowId: 'other',
        editableTitle: 'Renamed',
      })
    );
    store.dispatch(undo());

    expect(windows(store)[1].title).toBe('Other');
    expect(order(store)).toEqual(['a0', 'a1', 'g1a', 'g1b']);
  });

  // CONTROL. Both tests above would also pass if the middleware captured
  // everything. A move of a group that is not there changes nothing, so it
  // must be neither an undo step nor a sync.
  test('CONTROL: a move of an unknown group neither dirties nor pushes undo', () => {
    const store = seeded();
    const pastBefore = store.getState().undoRedo.past.length;
    store.dispatch(
      moveChromeGroupInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        groupId: 'nope',
        toIndex: 0,
      })
    );
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(pastBefore);
  });
});
