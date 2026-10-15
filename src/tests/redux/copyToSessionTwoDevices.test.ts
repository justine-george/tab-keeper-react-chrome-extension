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
}));

import reducer, {
  copyToSessionInternal,
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import { T0, container } from '../fixtures/sessionMoveFixture';
import { live } from '../fixtures/liveSnapshotFixture';

// Spec O12c "Two devices": a copy reaches the other device and survives its next sync.
// A copy changes ONE session, so Q1's loss (a move changes two) does not apply.
const base = (): TabMasterContainer =>
  reducer(undefined, replaceState(container()));

const deviceACopies = (at: number): TabMasterContainer => {
  vi.setSystemTime(at);
  return reducer(
    base(),
    copyToSessionInternal(
      {
        pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
      },
      live()
    )
  );
};

// Every copy of tab l1 anywhere in the container, by session.
const whereIsL1 = (c: TabMasterContainer): string[] =>
  c.tabGroups.flatMap((g) =>
    g.windows.flatMap((w) =>
      w.tabs.filter((t) => t.tabId === 'l1').map(() => g.tabGroupId)
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

describe('a copy from Open now meets another device', () => {
  it('B receives the copy, and keeps it through its next sync', () => {
    const cloud = deviceACopies(T0 + 1_000);
    const { merged: onB } = mergeTabContainers(base(), cloud, T0 + 2_000);
    expect(whereIsL1(onB)).toEqual(['S2']);
    vi.setSystemTime(T0 + 3_000);
    const bEdits = reducer(
      onB,
      updateTabGroupTitle({ tabGroupId: 'S3', editableTitle: 'Renamed on B' })
    );
    const { merged: next } = mergeTabContainers(bEdits, cloud, T0 + 4_000);
    expect(whereIsL1(next)).toEqual(['S2']);
  });
});
