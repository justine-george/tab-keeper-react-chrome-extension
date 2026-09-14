import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
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
  displayToast: vi.fn(),
}));

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  moveTabAcrossWindowsInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-132. sameSessionContent and sameWindowContent are module-private
// (tabContainerDataStateSlice.ts ~:927, ~:981); their only caller is the undo
// snapshot's reconciliation (~:2220: `current !== undefined &&
// !sameSessionContent(current, tabGroup)`), which decides whether a restored
// session gets its timestamp bumped past the cloud copy it is reverting. So
// the proof, per spec §8, is a store round trip -- move, undo, sync -- rather
// than a call into the comparator directly.
//
// A cross-window move is a distinctive case for that comparator: the
// session's OWN scalar fields (title, createdTime, createdAt, rank,
// isAutoSave, windowCount, tabCount) are untouched by it -- the tab is still
// in the session, only tabCount moves between two windows that both survive.
// So unlike a window reorder or a group move, detecting a cross-window move
// depends entirely on sameWindowContent actually walking each window's tabs;
// nothing at the session level notices on its own.

const win = (
  id: string,
  title: string,
  tabs: { tabId: string; title: string; url: string }[]
) => ({
  windowId: id,
  windowHeight: 100,
  windowWidth: 100,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title,
  tabs: tabs.map((t) => ({ ...t, favicon: '' })),
  chromeTabGroups: [],
});

function seed(overrides: Partial<tabContainerData> = {}): tabContainerData {
  return {
    tabGroupId: 's1',
    title: 'Alpha',
    createdTime: '2026-09-12 00:00:00',
    createdAt: Date.UTC(2026, 8, 12, 0, 0, 0),
    windowCount: 2,
    tabCount: 4,
    isAutoSave: false,
    isSelected: false,
    windows: [
      win('wA', 'A', [
        { tabId: 'a0', title: 'a0', url: 'https://a0.test' },
        { tabId: 'a1', title: 'a1', url: 'https://a1.test' },
      ]),
      win('wB', 'B', [
        { tabId: 'b0', title: 'b0', url: 'https://b0.test' },
        { tabId: 'b1', title: 'b1', url: 'https://b1.test' },
      ]),
    ],
    ...overrides,
  };
}

const tabsOf = (state: { tabGroups: tabContainerData[] }, windowId: string) =>
  state.tabGroups
    .find((g) => g.tabGroupId === 's1')!
    .windows.find((w) => w.windowId === windowId)!
    .tabs.map((t) => t.tabId);

const tabCountOf = (
  state: { tabGroups: tabContainerData[] },
  windowId: string
) =>
  state.tabGroups
    .find((g) => g.tabGroupId === 's1')!
    .windows.find((w) => w.windowId === windowId)!.tabCount;

describe('undoing a cross-window tab move survives the next sync (KAN-132)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the arrangement the user undid, and an edit made elsewhere', async () => {
    const T0 = Date.UTC(2026, 8, 12, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));
      store.dispatch(saveToTabContainerInternal(seed()));
      store.dispatch(
        saveToTabContainerInternal(seed({ tabGroupId: 's2', title: 'Bravo' }))
      );

      vi.setSystemTime(T0 + 1_000);
      store.dispatch(
        moveTabAcrossWindowsInternal({
          tabGroupId: 's1',
          fromWindowId: 'wA',
          toWindowId: 'wB',
          tabId: 'a0',
          toIndex: 0,
        })
      );

      // The cloud received the move exactly as auto-sync would have pushed
      // it, before the undo -- AND a rename of s2 made on another device,
      // which this device never saw.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      expect(tabsOf(cloud, 'wA')).toEqual(['a1']);
      expect(tabsOf(cloud, 'wB')).toEqual(['a0', 'b0', 'b1']);
      const s2 = cloud.tabGroups.find((g) => g.tabGroupId === 's2')!;
      s2.title = 'EDITED ON LAPTOP';
      s2.lastModified = T0 + 500;

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const afterUndo = store.getState().tabContainerDataState;
      // The undo itself works. Asserted separately from the merge because
      // the two failure modes look identical from the UI and are not the
      // same bug.
      expect(tabsOf(afterUndo, 'wA')).toEqual(['a0', 'a1']);
      expect(tabsOf(afterUndo, 'wB')).toEqual(['b0', 'b1']);

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState;
      // Both windows hold their pre-move tabs: source regains the tab,
      // destination loses it, counts restored.
      expect(tabsOf(merged, 'wA')).toEqual(['a0', 'a1']);
      expect(tabsOf(merged, 'wB')).toEqual(['b0', 'b1']);
      expect(tabCountOf(merged, 'wA')).toBe(2);
      expect(tabCountOf(merged, 'wB')).toBe(2);
      // CONTROL: a comparator that reported every session as changed would
      // pass the assertions above by clobbering this edit made elsewhere.
      expect(merged.tabGroups.find((g) => g.tabGroupId === 's2')!.title).toBe(
        'EDITED ON LAPTOP'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries a cross-window move made on another device through a merge untouched', async () => {
    const T0 = Date.UTC(2026, 8, 12, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));
      store.dispatch(saveToTabContainerInternal(seed()));

      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const s1 = cloud.tabGroups.find((g) => g.tabGroupId === 's1')!;
      const [wA, wB] = s1.windows;
      const [moved, ...rest] = wA.tabs;
      wA.tabs = rest;
      wA.tabCount = rest.length;
      wB.tabs = [moved, ...wB.tabs];
      wB.tabCount = wB.tabs.length;
      s1.lastModified = T0 + 1_000;

      vi.setSystemTime(T0 + 2_000);
      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState;
      expect(tabsOf(merged, 'wA')).toEqual(['a1']);
      expect(tabsOf(merged, 'wB')).toEqual(['a0', 'b0', 'b1']);
    } finally {
      vi.useRealTimers();
    }
  });
});
