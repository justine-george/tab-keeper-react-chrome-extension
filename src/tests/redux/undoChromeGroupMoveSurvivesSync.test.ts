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
  moveChromeGroupInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-160. A group move is only a new tab order, with no new field, so it
// syncs because sameWindowContent compares tabs BY POSITION. Asserted, not
// assumed: that comparator is a whitelist, and every field it misses is a
// field whose undo the next sync silently reverts (KAN-80, KAN-83, KAN-125).
//
// The cloud holds an edit this device never made, so a comparator that
// reports every session as changed cannot pass by clobbering it.

const tab = (tabId: string, chromeGroupId?: string) => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

function seed(overrides: Partial<tabContainerData> = {}): tabContainerData {
  return {
    tabGroupId: 's1',
    title: 'Alpha session',
    createdTime: '2026-09-11 00:00:00',
    createdAt: Date.UTC(2026, 8, 11, 0, 0, 0),
    windowCount: 1,
    tabCount: 4,
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
    ],
    ...overrides,
  };
}

const orderOf = (state: { tabGroups: tabContainerData[] }, id = 's1') =>
  state.tabGroups
    .find((g) => g.tabGroupId === id)!
    .windows[0].tabs.map((t) => t.tabId);

describe('undoing a group move survives the next sync (KAN-160)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the order the user undid, and an edit made elsewhere', async () => {
    const T0 = Date.UTC(2026, 8, 11, 12, 0, 0);
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
        moveChromeGroupInternal({
          tabGroupId: 's1',
          windowId: 'w',
          groupId: 'alpha',
          toIndex: 2,
        })
      );

      // The cloud holds the move, as auto-sync pushed it, AND a rename of s2
      // made on another device, which this device never saw.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      expect(orderOf(cloud)).toEqual(['a0', 'a1', 'g1a', 'g1b']);
      const s2 = cloud.tabGroups.find((g) => g.tabGroupId === 's2')!;
      s2.title = 'EDITED ON LAPTOP';
      s2.lastModified = T0 + 500;

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const afterUndo = store.getState().tabContainerDataState;
      expect(orderOf(afterUndo)).toEqual(['a0', 'g1a', 'g1b', 'a1']);

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState;
      expect(orderOf(merged)).toEqual(['a0', 'g1a', 'g1b', 'a1']);
      // CONTROL: a comparator that called every session changed would pass
      // the line above by clobbering this.
      expect(merged.tabGroups.find((g) => g.tabGroupId === 's2')!.title).toBe(
        'EDITED ON LAPTOP'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries a group move made on another device through a merge untouched', async () => {
    const T0 = Date.UTC(2026, 8, 11, 12, 0, 0);
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
      const w = s1.windows[0];
      w.tabs = [w.tabs[1], w.tabs[2], w.tabs[0], w.tabs[3]]; // alpha moved first
      s1.lastModified = T0 + 1_000;

      vi.setSystemTime(T0 + 2_000);
      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      expect(orderOf(store.getState().tabContainerDataState)).toEqual([
        'g1a',
        'g1b',
        'a0',
        'a1',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
