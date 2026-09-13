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
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  moveChromeGroupAcrossWindowsParams,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// Window A: a loose tab plus a TWO-member group `solo`.
// Window B: two loose tabs and its own one-member group `own`.
//
// Items in A: [tab:a0, group:solo]. Items in B: [tab:b0, group:own, tab:b1].
const t = (tabId: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

const build = (windowATabs?: tabData[]) => {
  const aTabs = windowATabs ?? [t('a0'), t('s0', 'solo'), t('s1', 'solo')];
  const bTabs = [t('b0'), t('o0', 'own'), t('b1')];
  return {
    tabGroupId: 'tg',
    title: 'Session',
    createdTime: '2026-09-12 00:00:00',
    createdAt: Date.parse('2026-09-12T00:00:00Z'),
    windowCount: 2,
    tabCount: aTabs.length + bTabs.length,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: 'wA',
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: aTabs.length,
        title: 'A',
        tabs: aTabs,
        chromeTabGroups: [{ groupId: 'solo', title: 'Solo', color: 'blue' }],
      },
      {
        windowId: 'wB',
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: bTabs.length,
        title: 'B',
        tabs: bTabs,
        chromeTabGroups: [{ groupId: 'own', title: 'Own', color: 'red' }],
      },
    ],
  };
};

type Store = ReturnType<typeof makeTestStore>['store'];

const seeded = (windowATabs?: tabData[]) => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(build(windowATabs)));
  store.dispatch(setIsNotDirty());
  return store;
};
const session = (s: Store) => s.getState().tabContainerDataState.tabGroups[0];
const win = (s: Store, windowId: string) =>
  session(s).windows.find((w) => w.windowId === windowId);
const order = (s: Store, windowId: string) =>
  win(s, windowId)!.tabs.map((x) => x.tabId);
const move = (
  s: Store,
  over: Partial<moveChromeGroupAcrossWindowsParams> = {}
) =>
  s.dispatch(
    moveChromeGroupAcrossWindowsInternal({
      tabGroupId: 'tg',
      fromWindowId: 'wA',
      toWindowId: 'wB',
      groupId: 'solo',
      toIndex: 0,
      ...over,
    })
  );

describe('moveChromeGroupAcrossWindowsInternal', () => {
  test('the group lands contiguously at the destination index, in its own order', () => {
    const store = seeded();
    move(store, { toIndex: 1 });
    expect(order(store, 'wA')).toEqual(['a0']);
    expect(order(store, 'wB')).toEqual(['b0', 's0', 's1', 'o0', 'b1']);
  });

  test('the group metadata moves to the destination and off the source', () => {
    const store = seeded();
    move(store, { toIndex: 1 });
    expect(win(store, 'wA')!.chromeTabGroups).toEqual([]);
    expect(win(store, 'wB')!.chromeTabGroups).toEqual(
      expect.arrayContaining([
        { groupId: 'own', title: 'Own', color: 'red' },
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ])
    );
  });

  test('moves the counts with it, leaving the session total alone', () => {
    const store = seeded();
    move(store, { toIndex: 1 });
    expect(win(store, 'wA')!.tabCount).toBe(1);
    expect(win(store, 'wB')!.tabCount).toBe(5);
    expect(session(store).tabCount).toBe(6);
  });

  test('toIndex past the end lands the group after the destination last item', () => {
    const store = seeded();
    move(store, { toIndex: 99 });
    expect(order(store, 'wB')).toEqual(['b0', 'o0', 'b1', 's0', 's1']);
  });

  test('a source window whose last tabs leave is removed', () => {
    // Window A holds ONLY the group here -- no loose tab left behind -- so
    // the move empties it entirely.
    const store = seeded([t('s0', 'solo'), t('s1', 'solo')]);
    move(store, { toIndex: 0 });
    expect(win(store, 'wA')).toBeUndefined();
    expect(session(store).windowCount).toBe(1);
    expect(session(store).tabCount).toBe(5);
  });

  test("the destination's own group is untouched", () => {
    const store = seeded();
    move(store, { toIndex: 0 });
    const ownGroup = win(store, 'wB')!.chromeTabGroups!.find(
      (g) => g.groupId === 'own'
    );
    expect(ownGroup).toEqual({ groupId: 'own', title: 'Own', color: 'red' });
    // Its own member tab must not have been touched or reordered away.
    expect(
      win(store, 'wB')!.tabs.find((tab) => tab.tabId === 'o0')?.chromeGroupId
    ).toBe('own');
  });

  test('the tabs keep their chromeGroupId -- the group moved, membership did not', () => {
    const store = seeded();
    move(store, { toIndex: 0 });
    const membership = Object.fromEntries(
      win(store, 'wB')!.tabs.map((x) => [x.tabId, x.chromeGroupId])
    );
    expect(membership.s0).toBe('solo');
    expect(membership.s1).toBe('solo');
  });

  test.each([
    ['tabGroupId', { tabGroupId: 'nope' }],
    ['fromWindowId', { fromWindowId: 'nope' }],
    ['toWindowId', { toWindowId: 'nope' }],
    ['groupId', { groupId: 'nope' }],
  ])('an unknown %s is inert', (_label, over) => {
    const store = seeded();
    const stateBefore = store.getState().tabContainerDataState;
    move(store, over);
    expect(store.getState().tabContainerDataState).toBe(stateBefore);
  });

  test('fromWindowId === toWindowId does nothing -- moveChromeGroupInternal owns it', () => {
    const store = seeded();
    const stateBefore = store.getState().tabContainerDataState;
    move(store, { toWindowId: 'wA' });
    expect(store.getState().tabContainerDataState).toBe(stateBefore);
  });
});
