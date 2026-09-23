import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import {
  replaceState,
  saveToTabContainerInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-83. The guard that keeps the KAN-80 regression from coming back.
//
// KAN-80 made undo tombstone every session missing from the restored snapshot,
// on the assumption that the only such session is the one the undo retracts.
// That is false. The undo history and the container are two independent
// notions of "what this device has", and they drift:
//
//   * replaceState is NOT in actionsToCapture, so a session arriving through
//     it enters the container but no snapshot -- the shape another page's
//     write will take once D9 lands, and still reachable today by anything
//     that calls replaceState directly (KAN-279's own merge no longer drifts
//     this way: a merge that changes local data resets undo outright, D12,
//     which would make this guard's undo a no-op and pass the assertion
//     below vacuously regardless of whether the guard exists. replaceState
//     is what still exercises it.)
//   * setPresentStartup refreshes `present` after the first sync but never
//     refreshes `past`
//
// So no comparison available inside the reducer reliably means "the user
// retracted this". A session created on another device looked retracted, was
// tombstoned, and the tombstone propagated and deleted it there too.
//
// A tombstone is the thing that cannot be taken back. A session briefly
// vanishing from local state is harmless -- the next merge restores anything
// with no tombstone against it, which is exactly what this asserts.

function group(id: string): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' },
        ],
      },
    ],
  };
}

const ids = (gs: tabContainerData[]) => gs.map((g) => g.tabGroupId).sort();

describe('undo never tombstones a session it did not create', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('leaves a session that arrived from another device alone', () => {
    const { store } = makeTestStore();

    store.dispatch(saveToTabContainerInternal(group('mine-1')));
    store.dispatch(saveToTabContainerInternal(group('mine-2')));

    // Stand-in for another page writing shared localStorage -- the drift D9
    // will handle once the pop-out lands. replaceState is not in
    // actionsToCapture, so this does not touch undoRedo at all: unlike a
    // merge through syncStateWithFirestore, which would now reset history
    // under D12 (KAN-279) and make the undo below a no-op, passing the
    // assertion vacuously regardless of whether this guard exists.
    const withTheirs = {
      ...store.getState().tabContainerDataState,
      tabGroups: [
        ...store.getState().tabContainerDataState.tabGroups,
        group('theirs'),
      ],
    };
    store.dispatch(replaceState(withTheirs));

    // The control: the write really did bring 'theirs' in, so a later
    // absence is this device losing it rather than the fixture never
    // delivering it.
    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'mine-1',
      'mine-2',
      'theirs',
    ]);

    // PREMISE: undo has something to retract, and the snapshot it would pop
    // predates 'theirs' arriving -- the KAN-83 shape exactly. Without this,
    // an empty `past` (KAN-292) would make the undo below a no-op for a
    // different reason and the test would pass without exercising the guard.
    expect(store.getState().undoRedo.past.length).toBeGreaterThan(0);
    expect(
      store
        .getState()
        .undoRedo.present.tabContainerDataState.tabGroups.map(
          (g) => g.tabGroupId
        )
    ).not.toContain('theirs');

    store.dispatch(undo());

    const graves = (
      store.getState().tabContainerDataState.deletedTabGroups ?? []
    ).map((t) => t.tabGroupId);
    expect(graves).not.toContain('theirs');
  });
});
