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
  addCurrTabToChromeGroupInternal,
  ungroupChromeTabGroup,
  deleteChromeTabGroupInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// Same trap as KAN-107: an action missing from actionsToCapture still renders
// and still reaches localStorage, so it looks correct in a component test
// while silently losing its undo step and the dirty flag that syncs it.
// Asserted as consequences, not as membership of a list.

const build = () => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-06 00:00:00',
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
        { tabId: 'loose', favicon: '', title: 'Loose', url: 'https://a.co' },
        {
          tabId: 'g1',
          favicon: '',
          title: 'One',
          url: 'https://b.co',
          chromeGroupId: 'grp',
        },
        {
          tabId: 'g2',
          favicon: '',
          title: 'Two',
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
const win = (s: Store) =>
  s.getState().tabContainerDataState.tabGroups[0].windows[0];
const target = { tabGroupId: 'tg', windowId: 'w', groupId: 'grp' };

describe('the Chrome group actions are captured actions', () => {
  test('adding a tab is undoable and dirties the container', () => {
    const store = seeded();
    store.dispatch(
      addCurrTabToChromeGroupInternal({
        ...target,
        tabData: {
          tabId: 'added',
          favicon: '',
          title: 'Added',
          url: 'https://d.co',
        },
      })
    );
    expect(win(store).tabs).toHaveLength(4);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(win(store).tabs).toHaveLength(3);
  });

  test('ungrouping is undoable and dirties the container', () => {
    const store = seeded();
    store.dispatch(ungroupChromeTabGroup(target));
    expect(win(store).chromeTabGroups).toEqual([]);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(win(store).chromeTabGroups).toHaveLength(1);
  });

  test('deleting a group is undoable and dirties the container', () => {
    const store = seeded();
    store.dispatch(deleteChromeTabGroupInternal(target));
    expect(win(store).tabs).toHaveLength(1);
    expect(store.getState().globalState.isDirty).toBe(true);

    store.dispatch(undo());
    expect(win(store).tabs).toHaveLength(3);
  });

  // THE CONTROL. All three assertions above would also pass if the middleware
  // captured every action indiscriminately. An action aimed at a group that is
  // not there changes nothing, so it must not become an undo step or dirty.
  test('CONTROL: an action on an unknown group neither dirties nor pushes undo', () => {
    const store = seeded();
    const pastBefore = store.getState().undoRedo.past.length;

    store.dispatch(ungroupChromeTabGroup({ ...target, groupId: 'nope' }));

    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(pastBefore);
  });
});
