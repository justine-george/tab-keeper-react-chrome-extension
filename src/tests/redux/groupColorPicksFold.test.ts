import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
  saveToFirestore: vi.fn<(userId: string, data: unknown) => Promise<void>>(
    async () => undefined
  ),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
}));

import {
  setIsNotDirty,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  updateChromeTabGroupColor,
  updateChromeTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { redo, resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';

// KAN-936. Picks in one open menu are one undo step, and each still syncs.

const session = (): tabContainerData => ({
  tabGroupId: 's1',
  title: 'Alpha',
  createdTime: '2026-08-31 00:00:00',
  createdAt: Date.UTC(2026, 7, 31, 0, 0, 0),
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'window',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Kagi',
          url: 'https://kagi.com/',
          chromeGroupId: 'grp',
        },
      ],
      chromeTabGroups: [{ groupId: 'grp', title: 'Reading', color: 'blue' }],
    },
  ],
});

const target = { tabGroupId: 's1', windowId: 'w1', groupId: 'grp' };

function setup() {
  const { store } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  store.dispatch(saveToTabContainerInternal(session()));
  const pastBefore = store.getState().undoRedo.past.length;
  const color = () =>
    store.getState().tabContainerDataState.tabGroups[0].windows[0]
      .chromeTabGroups?.[0].color;
  const pick = (next: string, colorPickRun?: number) =>
    store.dispatch(
      updateChromeTabGroupColor({ ...target, color: next, colorPickRun })
    );
  const steps = () => store.getState().undoRedo.past.length - pastBefore;
  return { store, color, pick, steps };
}

const lastSaved = () =>
  mocks.saveToFirestore.mock.lastCall?.[1] as TabMasterContainer | undefined;
const lastSavedColor = () =>
  lastSaved()?.tabGroups[0].windows[0].chromeTabGroups?.[0].color;

beforeEach(() => {
  mocks.loadFromFirestore.mockReset();
  mocks.loadFromFirestore.mockResolvedValue(undefined);
  mocks.saveToFirestore.mockClear();
});

describe('group color picks in one open menu', () => {
  it('are one undo step, back to the color before the menu opened', () => {
    const { store, color, pick, steps } = setup();
    pick('red', 1);
    pick('green', 1);
    pick('pink', 1);
    expect(color()).toBe('pink');
    expect(steps()).toBe(1);

    store.dispatch(undo());
    expect(color()).toBe('blue');
  });

  it('redo brings the last pick back in one step', () => {
    const { store, color, pick } = setup();
    pick('red', 1);
    pick('green', 1);
    store.dispatch(undo());
    store.dispatch(redo());
    expect(color()).toBe('green');
  });

  it('mark the session dirty on every pick, the fold included', () => {
    const { store, pick } = setup();
    pick('red', 1);
    store.dispatch(setIsNotDirty());
    pick('green', 1);
    expect(store.getState().globalState.isDirty).toBe(true);
  });

  it('reach the cloud: the last color, then the original after an undo', async () => {
    const { store, pick } = setup();
    pick('red', 1);
    pick('green', 1);
    await store.dispatch(syncStateWithFirestore());
    expect(lastSavedColor()).toBe('green');

    mocks.loadFromFirestore.mockResolvedValue(lastSaved());
    store.dispatch(undo());
    await store.dispatch(syncStateWithFirestore());
    expect(lastSavedColor()).toBe('blue');
  });

  it('fold across a sync that lands between two picks', async () => {
    const { store, color, pick, steps } = setup();
    pick('red', 1);
    await store.dispatch(syncStateWithFirestore());
    mocks.loadFromFirestore.mockResolvedValue(lastSaved());
    pick('green', 1);
    expect(steps()).toBe(1);

    store.dispatch(undo());
    expect(color()).toBe('blue');
  });

  it('clear the redo branch when a pick folds, as any new edit does', () => {
    const { store, color, pick } = setup();
    pick('red', 1);
    pick('green', 1);
    store.dispatch(undo());
    store.dispatch(redo());
    pick('pink', 1);
    store.dispatch(undo());
    store.dispatch(redo());
    expect(color()).toBe('pink');
    expect(store.getState().undoRedo.future).toHaveLength(0);
  });

  it('picking the color the group already has changes nothing', () => {
    const { color, pick, steps } = setup();
    pick('blue', 1);
    expect(color()).toBe('blue');
    expect(steps()).toBe(0);
  });
});

describe('what does not fold', () => {
  it('a second menu starts its own step', () => {
    const { store, color, pick, steps } = setup();
    pick('red', 1);
    pick('green', 2);
    expect(steps()).toBe(2);

    store.dispatch(undo());
    expect(color()).toBe('red');
  });

  it("the strip's picks stay a step each", () => {
    const { store, color, pick, steps } = setup();
    pick('red');
    pick('green');
    expect(steps()).toBe(2);

    store.dispatch(undo());
    expect(color()).toBe('red');
  });

  it('another edit between two picks keeps its own step', () => {
    const { store, color, pick, steps } = setup();
    pick('red', 1);
    store.dispatch(
      updateChromeTabGroupTitle({ ...target, editableTitle: 'Later' })
    );
    pick('green', 1);
    expect(steps()).toBe(3);

    store.dispatch(undo());
    expect(color()).toBe('red');
  });

  it('a change from elsewhere between two picks resets the history under them', () => {
    const { store, color, pick } = setup();
    pick('red', 1);
    store.dispatch(
      resetHistory({
        tabContainerDataState: store.getState().tabContainerDataState,
      })
    );
    pick('green', 1);
    expect(store.getState().undoRedo.past).toHaveLength(1);

    store.dispatch(undo());
    expect(color()).toBe('red');
  });

  it('a pick after an undo in the same menu starts a new step', () => {
    const { store, color, pick, steps } = setup();
    pick('red', 1);
    store.dispatch(undo());
    pick('green', 1);
    expect(steps()).toBe(1);

    store.dispatch(undo());
    expect(color()).toBe('blue');
  });
});
