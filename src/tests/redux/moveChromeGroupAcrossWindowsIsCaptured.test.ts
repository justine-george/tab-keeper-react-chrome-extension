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
  moveChromeGroupAcrossWindowsInternal,
  updateWindowGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// Same trap as moveChromeGroupIsCaptured.test.ts, one level up: a group moved
// ACROSS windows is a different action (MOVE_CHROME_GROUP_ACROSS_WINDOWS_ACTION),
// and Task 9 added the reducer without a test proving the middleware captures
// it. If it is missing from actionsToCapture the move still renders and still
// reaches localStorage, but gets no undo step and never dirties the container,
// so it never syncs -- and the NEXT captured edit snapshots state that already
// includes it, so undoing that edit reverts the move too.

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
  createdTime: '2026-09-12 00:00:00',
  windowCount: 2,
  tabCount: 6,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'wA',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 3,
      title: 'A',
      tabs: [tab('a0'), tab('s0', 'solo'), tab('s1', 'solo')],
      chromeTabGroups: [{ groupId: 'solo', title: 'Solo', color: 'blue' }],
    },
    {
      windowId: 'wB',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 3,
      title: 'B',
      tabs: [tab('b0'), tab('o0', 'own'), tab('b1')],
      chromeTabGroups: [{ groupId: 'own', title: 'Own', color: 'red' }],
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
const orderOf = (s: Store, windowId: string) =>
  windows(s)
    .find((w) => w.windowId === windowId)!
    .tabs.map((t) => t.tabId);
const moveSoloToB = (s: Store) =>
  s.dispatch(
    moveChromeGroupAcrossWindowsInternal({
      tabGroupId: 'tg',
      fromWindowId: 'wA',
      toWindowId: 'wB',
      groupId: 'solo',
      toIndex: 0,
    })
  );

describe('moving a Chrome group across windows is a captured action', () => {
  test('it dirties the container and is undone in one step', () => {
    const store = seeded();
    moveSoloToB(store);
    expect(orderOf(store, 'wA')).toEqual(['a0']);
    expect(orderOf(store, 'wB')).toEqual(['s0', 's1', 'b0', 'o0', 'b1']);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(orderOf(store, 'wA')).toEqual(['a0', 's0', 's1']);
    expect(orderOf(store, 'wB')).toEqual(['b0', 'o0', 'b1']);
  });

  // THE CASCADE. Only this shows the worse half of the failure.
  test('undoing the NEXT edit leaves the move in place', () => {
    const store = seeded();
    moveSoloToB(store);
    store.dispatch(
      updateWindowGroupTitle({
        tabGroupId: 'tg',
        windowId: 'wB',
        editableTitle: 'Renamed',
      })
    );
    store.dispatch(undo());

    expect(windows(store).find((w) => w.windowId === 'wB')!.title).toBe('B');
    expect(orderOf(store, 'wA')).toEqual(['a0']);
    expect(orderOf(store, 'wB')).toEqual(['s0', 's1', 'b0', 'o0', 'b1']);
  });

  // CONTROL. Both tests above would also pass if the middleware captured
  // everything. A move of a group that is not there changes nothing, so it
  // must be neither an undo step nor a sync.
  test('CONTROL: a move of an unknown group neither dirties nor pushes undo', () => {
    const store = seeded();
    const pastBefore = store.getState().undoRedo.past.length;
    store.dispatch(
      moveChromeGroupAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        groupId: 'nope',
        toIndex: 0,
      })
    );
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(pastBefore);
  });
});
