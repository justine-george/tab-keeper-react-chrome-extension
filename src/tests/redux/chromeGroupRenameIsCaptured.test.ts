import { describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
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
  updateChromeTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// A rename that is not in `actionsToCapture` still works on screen and still
// writes to localStorage, so it looks entirely correct in a component test.
// What it silently loses is everything the middleware confers: the undo step,
// and the dirty flag that is what eventually pushes the change to Firestore.
//
// So this file asserts the two CONSEQUENCES rather than the membership of a
// list -- a test that read actionsToCapture would pass against a reducer
// wired to the wrong action name.

const buildGroup = () => ({
  tabGroupId: 'group-1',
  title: 'Session',
  createdTime: '2026-09-06 09:00:00',
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window 1',
      tabs: [
        {
          tabId: 'w1-t0',
          favicon: '',
          title: 'Page',
          url: 'https://example.com/',
          chromeGroupId: 'cg-1',
        },
      ],
      chromeTabGroups: [{ groupId: 'cg-1', title: 'Research', color: 'blue' }],
    },
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];

const groupTitle = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups[0].windows[0]
    .chromeTabGroups![0].title;

// Saving is itself a captured action, so it leaves the container dirty and
// pushes an undo step. Both are cleared here so the assertions below measure
// the rename alone rather than the setup.
const seeded = () => {
  const { store, seen } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(buildGroup()));
  store.dispatch(setIsNotDirty());
  seen.length = 0;
  return {
    store,
    seen,
    pastAtStart: store.getState().undoRedo.past.length,
  };
};

const renameTo = (store: Store, editableTitle: string) =>
  store.dispatch(
    updateChromeTabGroupTitle({
      tabGroupId: 'group-1',
      windowId: 'win-1',
      groupId: 'cg-1',
      editableTitle,
    })
  );

describe('a Chrome group rename is a captured action', () => {
  test('undo restores the previous group name', () => {
    const { store } = seeded();

    renameTo(store, 'Reading');
    expect(groupTitle(store)).toBe('Reading');

    store.dispatch(undo());

    expect(groupTitle(store)).toBe('Research');
  });

  test('undo restores a name that was cleared', () => {
    const { store } = seeded();

    renameTo(store, '');
    expect(groupTitle(store)).toBe('');

    store.dispatch(undo());

    expect(groupTitle(store)).toBe('Research');
  });

  test('the rename marks the container dirty', () => {
    const { store } = seeded();
    expect(store.getState().globalState.isDirty).toBe(false);

    renameTo(store, 'Reading');

    expect(store.getState().globalState.isDirty).toBe(true);
  });

  // THE CONTROL. Every assertion above would also pass if the middleware
  // captured EVERY action indiscriminately. A rename that changes nothing is
  // the case the reducer declines to write, so it must not become an undo
  // step or mark the container dirty either.
  test('CONTROL: a no-op rename is not an undoable step and does not dirty', () => {
    const { store, pastAtStart } = seeded();

    renameTo(store, 'Research');

    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(pastAtStart);
  });
});
