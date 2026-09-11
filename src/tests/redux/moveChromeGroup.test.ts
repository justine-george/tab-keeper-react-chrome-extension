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
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  moveChromeGroupParams,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// KAN-160. A group moves as ONE item among its window's top-level rows (loose
// tabs and groups), carrying its tabs in order and its membership untouched.
// The index is the engine's: where the group lands in the item list with the
// group itself lifted out.
//
// Items in the seeded window: [tab:a0, group:alpha, tab:a1, group:beta].

const t = (tabId: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

// A factory: Immer freezes what it is handed, so a shared constant would
// arrive at the second test frozen.
const build = (
  tabs: tabData[] = [
    t('a0'),
    t('g1a', 'alpha'),
    t('g1b', 'alpha'),
    t('a1'),
    t('g2a', 'beta'),
    t('g2b', 'beta'),
  ]
) => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-11 00:00:00',
  createdAt: Date.parse('2026-09-11T00:00:00Z'),
  windowCount: 1,
  tabCount: tabs.length,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'w',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: tabs.length,
      title: 'Window',
      tabs,
      chromeTabGroups: [
        { groupId: 'alpha', title: 'Alpha', color: 'blue' },
        { groupId: 'beta', title: 'Beta', color: 'red' },
        // Listed but with no member tabs: there is no row for it to move.
        { groupId: 'empty', title: 'Empty', color: 'grey' },
      ],
    },
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];

const seeded = (tabs?: tabData[]) => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(build(tabs)));
  store.dispatch(setIsNotDirty());
  return store;
};
const session = (s: Store) => s.getState().tabContainerDataState.tabGroups[0];
const win = (s: Store) => session(s).windows[0];
const order = (s: Store) => win(s).tabs.map((x) => x.tabId);
const move = (
  s: Store,
  groupId: string,
  toIndex: number,
  over: Partial<moveChromeGroupParams> = {}
) =>
  s.dispatch(
    moveChromeGroupInternal({
      tabGroupId: 'tg',
      windowId: 'w',
      groupId,
      toIndex,
      ...over,
    })
  );

describe('moveChromeGroupInternal', () => {
  test('to the front, past a loose tab and another group', () => {
    const store = seeded();
    move(store, 'beta', 0);
    expect(order(store)).toEqual(['g2a', 'g2b', 'a0', 'g1a', 'g1b', 'a1']);
  });

  test('to the end', () => {
    const store = seeded();
    move(store, 'alpha', 3);
    expect(order(store)).toEqual(['a0', 'a1', 'g2a', 'g2b', 'g1a', 'g1b']);
  });

  test('after a loose tab', () => {
    const store = seeded();
    move(store, 'alpha', 2);
    expect(order(store)).toEqual(['a0', 'a1', 'g1a', 'g1b', 'g2a', 'g2b']);
  });

  test('before another group', () => {
    const store = seeded();
    move(store, 'beta', 1);
    expect(order(store)).toEqual(['a0', 'g2a', 'g2b', 'g1a', 'g1b', 'a1']);
  });

  test('members keep their order and every membership is untouched', () => {
    const store = seeded();
    const membership = () =>
      Object.fromEntries(
        win(store).tabs.map((x) => [x.tabId, x.chromeGroupId])
      );
    const before = membership();
    const groupsBefore = win(store).chromeTabGroups;
    move(store, 'beta', 0);
    expect(membership()).toEqual(before);
    expect(win(store).chromeTabGroups).toEqual(groupsBefore);
  });

  // A non-contiguous group is drawn as one band (it is one item), so moving
  // it writes it back contiguous -- the screen, the store and a restore then
  // agree.
  test('a non-contiguous group comes out contiguous', () => {
    const store = seeded([
      t('a0'),
      t('g1a', 'alpha'),
      t('a1'),
      t('g1b', 'alpha'),
      t('a2'),
    ]);
    // Items: [tab:a0, group:alpha, tab:a1, tab:a2]
    move(store, 'alpha', 3);
    expect(order(store)).toEqual(['a0', 'a1', 'a2', 'g1a', 'g1b']);
  });

  // Whether the move is undoable and synced is the middleware's decision, and
  // is pinned in moveChromeGroupIsCaptured.test.ts, not here.
  test('leaves the counts and createdAt alone', () => {
    const store = seeded();
    const createdAt = session(store).createdAt;
    move(store, 'alpha', 3);
    expect(session(store).tabCount).toBe(6);
    expect(win(store).tabCount).toBe(6);
    expect(session(store).createdAt).toBe(createdAt);
  });
});

describe('moveChromeGroupInternal does nothing when there is nothing to do', () => {
  // Picking a group up and putting it back is ordinary, and must not stamp,
  // save, push an undo step or sync.
  test('a drop in place is not an edit', () => {
    const store = seeded();
    const stateBefore = store.getState().tabContainerDataState;
    move(store, 'beta', 3);
    expect(store.getState().tabContainerDataState).toBe(stateBefore);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  test.each([
    ['session', { tabGroupId: 'nope' }],
    ['window', { windowId: 'nope' }],
  ])('an unknown %s changes nothing', (_label, over) => {
    const store = seeded();
    const stateBefore = store.getState().tabContainerDataState;
    move(store, 'alpha', 0, over);
    expect(store.getState().tabContainerDataState).toBe(stateBefore);
  });

  test('an unknown group, or a group with no tabs, changes nothing', () => {
    const store = seeded();
    const stateBefore = store.getState().tabContainerDataState;
    move(store, 'nope', 0);
    move(store, 'empty', 0);
    expect(store.getState().tabContainerDataState).toBe(stateBefore);
  });
});

// Clamped before the no-op comparison, as moveWindowInternal does, so an
// out-of-range drop onto the group's own slot is still not an edit.
describe('moveChromeGroupInternal clamps the destination', () => {
  test('past the end lands last', () => {
    const store = seeded();
    move(store, 'alpha', 99);
    expect(order(store)).toEqual(['a0', 'a1', 'g2a', 'g2b', 'g1a', 'g1b']);
  });

  test('below zero lands first', () => {
    const store = seeded();
    move(store, 'beta', -5);
    expect(order(store)).toEqual(['g2a', 'g2b', 'a0', 'g1a', 'g1b', 'a1']);
  });

  test('a clamped drop onto its own slot is not an edit', () => {
    const store = seeded();
    const stateBefore = store.getState().tabContainerDataState;
    move(store, 'beta', 99);
    expect(store.getState().tabContainerDataState).toBe(stateBefore);
  });
});
