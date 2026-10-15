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

import { makeTestStore } from '../setup/makeStore';
import {
  copyToNewSessionInternal,
  copyToSessionInternal,
  replaceState,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { redo, resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import type { CarriedPick } from '../../redux/carriedItem';
import {
  T0,
  container,
  sessionIds,
  tabIds,
  windowIn,
} from '../fixtures/sessionMoveFixture';
import { live } from '../fixtures/liveSnapshotFixture';

// KAN-280 Part F. A copy is one action, so one ⌘Z takes it back, and the sync carries it.
const L1: Extract<CarriedPick, { kind: 'tab' }> = {
  kind: 'tab',
  windowId: 'live-w',
  tabId: 'l1',
};

const ready = (c: TabMasterContainer = container()) => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a copy is one undo step, and synced', () => {
  it('copyToSessionInternal marks sync dirty and is one undo step; ⌘Z restores the target exactly; redo re-applies', () => {
    const { store } = ready();
    const before = structuredClone(store.getState().tabContainerDataState);
    const past = store.getState().undoRedo.past.length;
    vi.setSystemTime(T0 + 1_000);
    store.dispatch(
      copyToSessionInternal(
        { pick: L1, to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 } },
        live()
      )
    );
    expect(store.getState().globalState.isDirty).toBe(true);
    expect(store.getState().undoRedo.past.length).toBe(past + 1);

    vi.setSystemTime(T0 + 2_000);
    store.dispatch(undo());
    const stampless = (c: TabMasterContainer) =>
      c.tabGroups.map((g) => ({ ...g, lastModified: undefined }));
    expect(stampless(store.getState().tabContainerDataState)).toEqual(
      stampless(before)
    );

    vi.setSystemTime(T0 + 3_000);
    store.dispatch(redo());
    expect(
      tabIds(windowIn(store.getState().tabContainerDataState, 'S2', 'd1'))[0]
    ).toBe('l1');
  });

  it('copyToNewSessionInternal is one undo step that takes the new session away', () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    store.dispatch(copyToNewSessionInternal(L1, live(), 'New Tab Group'));
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(4);
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
    store.dispatch(undo());
    expect(sessionIds(store.getState().tabContainerDataState)).toEqual([
      'S3',
      'S2',
      'S1',
    ]);
  });
});
