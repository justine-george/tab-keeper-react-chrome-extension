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
  moveToSessionInternal,
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import {
  T0,
  container,
  sessionIn,
  tabIds,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-350 Q1 A, settled 2026-09-30. The sync merges per SESSION, the newer
// copy winning and the cloud taking exact ties. A move between sessions
// changes two sessions, and the merge has no idea they changed together.
//
// Device A moves tab t1 from S1 into S2 while offline. Device B, which still
// has t1 in S1, edits something and syncs first. A then syncs: its S1 (t1
// gone) meets the cloud's, and its S2 (t1 arrived) meets the cloud's, each on
// its own. Both devices start from the same cloud copy, and every edit below
// goes through the reducer the app dispatches.

const base = (): TabMasterContainer =>
  reducer(undefined, replaceState(container()));

// Device A, offline: the move, stamped S1 at `at`, S2 at `at + 1`.
const deviceAMoves = (at: number): TabMasterContainer => {
  vi.setSystemTime(at);
  return reducer(
    base(),
    moveToSessionInternal({
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
    })
  );
};

// Device B renames one session and syncs it up: the cloud is B's container.
const deviceBRenames = (tabGroupId: string, at: number): TabMasterContainer => {
  vi.setSystemTime(at);
  return reducer(
    base(),
    updateTabGroupTitle({ tabGroupId, editableTitle: 'Renamed on B' })
  );
};

// Every copy of tab t1 anywhere in the container, by session.
const whereIsT1 = (c: TabMasterContainer): string[] =>
  c.tabGroups.flatMap((g) =>
    g.windows.flatMap((w) =>
      w.tabs.filter((t) => t.tabId === 't1').map(() => g.tabGroupId)
    )
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a move between sessions meets another device (Q1 A)', () => {
  // THE SETTLED LOSS (Q1 A, KAN-350). B's edit to S2 is newer than A's copy
  // of S2, so B's S2 -- which never had t1 -- wins; A's S1 is newer than the
  // cloud's, so A's S1 -- which no longer has t1 -- wins. The tab is in
  // neither. Accepted as the existing per-session rule; a move-aware merge
  // is tracked separately. If this test starts failing because t1 survives,
  // the merge changed: update Q1's note, not this assertion.
  it('B edits the target later: the tab is in neither session', () => {
    const a = deviceAMoves(T0 + 1_000);
    expect(whereIsT1(a)).toEqual(['S2']);
    const cloud = deviceBRenames('S2', T0 + 2_000);

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(whereIsT1(merged)).toEqual([]);
    // Each side won the session it last changed.
    expect(sessionIn(merged, 'S2').title).toBe('Renamed on B');
    expect(tabIds(windowIn(merged, 'S1', 'w1'))).not.toContain('t1');
  });

  // Ties go to the cloud, deliberately (mergeTabData: the only convergent
  // choice). An edit on B in the very millisecond A stamped S2 is the same
  // loss.
  it('B edits the target in the same millisecond: the cloud takes the tie, and the tab is in neither', () => {
    const a = deviceAMoves(T0 + 1_000);
    expect(sessionIn(a, 'S2').lastModified).toBe(T0 + 1_001);
    const cloud = deviceBRenames('S2', T0 + 1_001);

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(whereIsT1(merged)).toEqual([]);
  });

  it('B edits an unrelated session: the tab is in the target exactly once', () => {
    const a = deviceAMoves(T0 + 1_000);
    const cloud = deviceBRenames('S3', T0 + 2_000);

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(whereIsT1(merged)).toEqual(['S2']);
    expect(tabIds(windowIn(merged, 'S2', 'd1'))).toEqual([
      't1',
      'u1',
      'u2',
      'u3',
    ]);
    expect(sessionIn(merged, 'S3').title).toBe('Renamed on B');
  });
});
