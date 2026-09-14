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
  moveChromeGroupAcrossWindowsInternal,
  restoreContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// Spec §11.5. A group moved ACROSS windows changes both windows' `tabs`
// arrays AND both windows' `chromeTabGroups` -- the group's metadata (title,
// colour) moves from the source window's list to the destination's. VERIFIED,
// not assumed: sameWindowContent ends with
// sameChromeTabGroups(a.chromeTabGroups, b.chromeTabGroups), and its
// positional tab walk compares tab.chromeGroupId. So the move is visible to
// the comparator twice over. This test proves the comparator actually reads
// one of those two signals by blinding both, then each alone, in
// blindComparator.test.ts-style fashion inline below.
//
// The cloud holds the move (auto-synced) AND an edit made on another device
// to a second session this device never saw -- the same shape as
// undoChromeGroupMoveSurvivesSync.test.ts -- so a comparator that reports
// every session changed cannot pass by clobbering the untouched session.

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
    createdTime: '2026-09-12 00:00:00',
    createdAt: Date.UTC(2026, 8, 12, 0, 0, 0),
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
    ...overrides,
  };
}

const windowsOf = (state: { tabGroups: tabContainerData[] }, id = 's1') =>
  state.tabGroups.find((g) => g.tabGroupId === id)!.windows;
const orderOf = (
  state: { tabGroups: tabContainerData[] },
  windowId: string,
  id = 's1'
) =>
  windowsOf(state, id)
    .find((w) => w.windowId === windowId)!
    .tabs.map((t) => t.tabId);
const groupsOf = (
  state: { tabGroups: tabContainerData[] },
  windowId: string,
  id = 's1'
) => windowsOf(state, id).find((w) => w.windowId === windowId)!.chromeTabGroups;

describe('undoing a cross-window group move survives the next sync (KAN-132, spec 11.5)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps both windows the user undid to, and an edit made elsewhere', async () => {
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
        moveChromeGroupAcrossWindowsInternal({
          tabGroupId: 's1',
          fromWindowId: 'wA',
          toWindowId: 'wB',
          groupId: 'solo',
          toIndex: 0,
        })
      );

      // The cloud holds the move, as auto-sync pushed it, AND a rename of s2
      // made on another device, which this device never saw.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      expect(orderOf(cloud, 'wA')).toEqual(['a0']);
      expect(orderOf(cloud, 'wB')).toEqual(['s0', 's1', 'b0', 'o0', 'b1']);
      expect(groupsOf(cloud, 'wA')).toEqual([]);
      expect(groupsOf(cloud, 'wB')).toEqual([
        { groupId: 'own', title: 'Own', color: 'red' },
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ]);
      const s2 = cloud.tabGroups.find((g) => g.tabGroupId === 's2')!;
      s2.title = 'EDITED ON LAPTOP';
      s2.lastModified = T0 + 500;

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const afterUndo = store.getState().tabContainerDataState;
      expect(orderOf(afterUndo, 'wA')).toEqual(['a0', 's0', 's1']);
      expect(orderOf(afterUndo, 'wB')).toEqual(['b0', 'o0', 'b1']);
      expect(groupsOf(afterUndo, 'wA')).toEqual([
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ]);
      expect(groupsOf(afterUndo, 'wB')).toEqual([
        { groupId: 'own', title: 'Own', color: 'red' },
      ]);

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState;
      // The undo must survive the sync: both windows back to their pre-move
      // tabs AND their pre-move chromeTabGroups.
      expect(orderOf(merged, 'wA')).toEqual(['a0', 's0', 's1']);
      expect(orderOf(merged, 'wB')).toEqual(['b0', 'o0', 'b1']);
      expect(groupsOf(merged, 'wA')).toEqual([
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ]);
      expect(groupsOf(merged, 'wB')).toEqual([
        { groupId: 'own', title: 'Own', color: 'red' },
      ]);
      // CONTROL: a comparator that called every session changed would pass
      // every assertion above by clobbering this.
      expect(merged.tabGroups.find((g) => g.tabGroupId === 's2')!.title).toBe(
        'EDITED ON LAPTOP'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries a group move made on another device through a merge untouched', async () => {
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
      // Simulate the other device's cross-window move: solo's two tabs
      // spliced into wB at index 0, wA left with just its loose tab, group
      // metadata moved with it.
      wB.tabs = [wA.tabs[1], wA.tabs[2], ...wB.tabs];
      wA.tabs = [wA.tabs[0]];
      wA.tabCount = 1;
      wB.tabCount = 5;
      wB.chromeTabGroups = [
        ...(wB.chromeTabGroups ?? []),
        ...(wA.chromeTabGroups ?? []),
      ];
      wA.chromeTabGroups = [];
      s1.lastModified = T0 + 1_000;

      vi.setSystemTime(T0 + 2_000);
      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState;
      expect(orderOf(merged, 'wA')).toEqual(['a0']);
      expect(orderOf(merged, 'wB')).toEqual(['s0', 's1', 'b0', 'o0', 'b1']);
      expect(groupsOf(merged, 'wA')).toEqual([]);
      expect(groupsOf(merged, 'wB')).toEqual([
        { groupId: 'own', title: 'Own', color: 'red' },
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The two tests above prove the REAL reducer's round trip works, but they
// cannot isolate chromeTabGroups from chromeGroupId/tabCount/tabs.length: a
// real cross-window move always changes both windows' tab counts (like
// delete-group and add-tab-to-group before it, per the comment above
// sameWindowContent), so the pre-existing length/identity checks already
// catch it -- verified by mutation, see task-10-report.md's blinding matrix.
//
// To isolate chromeTabGroups on its own -- the one state the tabs signal
// cannot see -- this constructs a group's metadata entry sitting in the
// WRONG window's chromeTabGroups list while every tab, in both windows, is
// byte-identical (same id, same order, same chromeGroupId) to the correct
// arrangement. That is exactly what a reducer bug that moved
// chromeTabGroupData (§11.4's second step) but left the tabs where they were
// would produce. Modelled on
// undoChromeGroupEditSurvivesSync.test.ts's "sees a tab that changed which
// group it belongs to", which isolates chromeGroupId the same way with
// chromeTabGroups held constant; this is its chromeTabGroups-side
// counterpart.
describe('a group entry attributed to the wrong window is caught with no tab movement (KAN-132, spec 11.5)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('an import correcting a misplaced group entry survives the next sync', async () => {
    const T0 = Date.UTC(2026, 8, 12, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));

      // Live: corrupted. Window A's tabs still say chromeGroupId: 'solo',
      // and window B's tabs still say chromeGroupId: 'own' -- nothing about
      // any TAB changed -- but 'solo's own entry sits in window B's
      // chromeTabGroups list instead of A's.
      const corrupted = seed();
      corrupted.windows[0].chromeTabGroups = [];
      corrupted.windows[1].chromeTabGroups = [
        { groupId: 'own', title: 'Own', color: 'red' },
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ];
      store.dispatch(saveToTabContainerInternal(corrupted));

      // The cloud already holds the corruption, as if auto-sync had already
      // pushed it.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      cloud.tabGroups[0].lastModified = T0 + 500;

      // A backup taken before the corruption: every tab identical, every
      // chromeGroupId identical -- only chromeTabGroups placement differs.
      const backup: TabMasterContainer = JSON.parse(JSON.stringify(cloud));
      backup.tabGroups[0].lastModified = T0;
      backup.lastModified = T0;
      backup.tabGroups[0].windows[0].chromeTabGroups = [
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ];
      backup.tabGroups[0].windows[1].chromeTabGroups = [
        { groupId: 'own', title: 'Own', color: 'red' },
      ];

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(restoreContainer(backup));

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      // The import IS a change to this session (chromeTabGroups moved), so
      // it must be stamped and must outrank the cloud copy it corrects.
      const merged = store.getState().tabContainerDataState;
      expect(groupsOf(merged, 'wA')).toEqual([
        { groupId: 'solo', title: 'Solo', color: 'blue' },
      ]);
      expect(groupsOf(merged, 'wB')).toEqual([
        { groupId: 'own', title: 'Own', color: 'red' },
      ]);
      // Tabs never moved -- this is the control that says the fixture is
      // actually isolating chromeTabGroups, not smuggling a tab change in.
      expect(orderOf(merged, 'wA')).toEqual(['a0', 's0', 's1']);
      expect(orderOf(merged, 'wB')).toEqual(['b0', 'o0', 'b1']);
    } finally {
      vi.useRealTimers();
    }
  });
});
