import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  moveToNewSessionInternal,
  replaceState,
  updateTabGroupTitle,
  type CarriedRef,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { redo, resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import {
  T0,
  container,
  s2,
  s3,
  session,
  sessionIds,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-394 P3 Task 13. The sync merges per SESSION. A move into a new session
// changes two (the source and the new one) and the merge does not know they
// changed together, so each outcome is pinned: a tombstone beats an older
// copy, a later edit beats a move, and an undo is a withdrawal that stays.

const NEW = 'NEW';
const NS = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const T1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};
const T3: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w2',
  tabId: 't3',
};

// A source whose only tab is t3: carrying it empties the session.
const lonelyS1 = () =>
  session('S1', 'Source', T0 - 3_600_000, [win('w2', [tab('t3')])]);

const base = (lonely = false): TabMasterContainer =>
  reducer(
    undefined,
    replaceState(lonely ? container([s3(), s2(), lonelyS1()]) : container())
  );

const newSession = (carried: CarriedRef, now: number) =>
  moveToNewSessionInternal(carried, 'Fallback', '', {
    tabGroupId: NEW,
    newWindowId: 'NEW-W',
    remintNamespace: NS,
    now,
  });

// Device A, offline: the move.
const deviceAMoves = (
  carried: CarriedRef,
  at: number,
  start: TabMasterContainer
): TabMasterContainer => {
  vi.setSystemTime(at);
  return reducer(start, newSession(carried, at));
};

const deviceBRenames = (
  tabGroupId: string,
  at: number,
  start: TabMasterContainer
): TabMasterContainer => {
  vi.setSystemTime(at);
  return reducer(
    start,
    updateTabGroupTitle({ tabGroupId, editableTitle: 'Renamed on B' })
  );
};

const whereIs = (c: TabMasterContainer, tabId: string): string[] =>
  c.tabGroups.flatMap((g) =>
    g.windows.flatMap((w) =>
      w.tabs.filter((t) => t.tabId === tabId).map(() => g.tabGroupId)
    )
  );

const graves = (c: TabMasterContainer): string[] =>
  (c.deletedTabGroups ?? []).map((g) => g.tabGroupId);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a move into a new session meets another device', () => {
  it('(a) B edits an unrelated session: the new session holds the item, once', () => {
    const a = deviceAMoves(T1, T0 + 1_000, base());
    const cloud = deviceBRenames('S3', T0 + 2_000, base());

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(whereIs(merged, 't1')).toEqual([NEW]);
    expect(tabIds(windowIn(merged, NEW, 'NEW-W'))).toEqual(['t1']);
    expect(sessionIn(merged, 'S3').title).toBe('Renamed on B');
    expect(sessionIds(merged)).toContain(NEW);
  });

  it('(b) the move empties S1 and B holds the older S1: S1 stays deleted, the item is in the new session', () => {
    const a = deviceAMoves(T3, T0 + 1_000, base(true));
    expect(graves(a)).toEqual(['S1']);
    const cloud = base(true);

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(sessionIds(merged)).not.toContain('S1');
    expect(graves(merged)).toContain('S1');
    expect(whereIs(merged, 't3')).toEqual([NEW]);
  });

  // D22, pinned: a later edit on B keeps S1 as B has it, so the item is in
  // both. Duplicated, never lost.
  it('(c) B edits S1 later: the item is in S1 and in the new session', () => {
    const a = deviceAMoves(T1, T0 + 1_000, base());
    const cloud = deviceBRenames('S1', T0 + 2_000, base());

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(sessionIn(merged, 'S1').title).toBe('Renamed on B');
    expect(whereIs(merged, 't1').sort()).toEqual([NEW, 'S1']);
  });

  // The cloud is what A last wrote, accumulating: the move, then the undo.
  it.each([
    ['a source that keeps other tabs', false, T1, 't1'],
    ['a source the move emptied (tombstoned)', true, T3, 't3'],
  ] as const)(
    '(d) A syncs, undoes, syncs again, over %s: the new session stays gone, S1 is back',
    (_, lonely, carried, tabId) => {
      const { store } = makeTestStore();
      store.dispatch(replaceState(base(lonely)));
      store.dispatch(
        resetHistory({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );

      vi.setSystemTime(T0 + 1_000);
      store.dispatch(newSession(carried, T0 + 1_000));
      // A's first sync: the cloud now holds exactly what A wrote.
      const cloud = structuredClone(store.getState().tabContainerDataState);
      expect(sessionIds(cloud)).toContain(NEW);

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const local = store.getState().tabContainerDataState;

      const { merged } = mergeTabContainers(local, cloud, T0 + 3_000);

      expect(sessionIds(merged)).not.toContain(NEW);
      expect(graves(merged)).toContain(NEW);
      expect(sessionIds(merged)).toContain('S1');
      expect(graves(merged)).not.toContain('S1');
      expect(whereIs(merged, tabId)).toEqual(['S1']);

      // And redo, synced over the same cloud, brings the session back.
      vi.setSystemTime(T0 + 4_000);
      store.dispatch(redo());
      const again = mergeTabContainers(
        store.getState().tabContainerDataState,
        merged,
        T0 + 5_000
      ).merged;
      expect(sessionIds(again)).toContain(NEW);
      expect(graves(again)).not.toContain(NEW);
    }
  );
});
