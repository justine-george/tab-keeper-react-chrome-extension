import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-83. The guard that keeps the KAN-80 regression from coming back.
//
// KAN-80 made undo tombstone every session missing from the restored snapshot,
// on the assumption that the only such session is the one the undo retracts.
// That is false. The undo history and the merged container are two independent
// notions of "what this device has", and they drift:
//
//   * replaceState -- what the merge uses -- is NOT in actionsToCapture, so a
//     session arriving from another device enters the container but no snapshot
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
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('leaves a session that arrived from another device alone', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('mine-1')));
    store.dispatch(saveToTabContainerInternal(group('mine-2')));

    // Another device created 'theirs'; it arrives on the next sync.
    const local = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    const cloud = {
      ...local,
      lastModified: Date.now() + 1000,
      tabGroups: [
        ...local.tabGroups,
        { ...group('theirs'), lastModified: Date.now() + 1000 },
      ],
    };
    localStorage.setItem('tabContainerData', JSON.stringify(local));
    mocks.loadFromFirestore.mockResolvedValue(cloud);
    await store.dispatch(syncStateWithFirestore() as never);

    // The control: the merge really did bring it in, so a later absence is
    // this device losing it rather than the fixture never delivering it.
    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'mine-1',
      'mine-2',
      'theirs',
    ]);

    store.dispatch(undo());

    const graves = (
      store.getState().tabContainerDataState.deletedTabGroups ?? []
    ).map((t) => t.tabGroupId);
    expect(graves).not.toContain('theirs');

    // And it survives: with no tombstone against it, the next merge restores
    // it from the cloud.
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(store.getState().tabContainerDataState)
    );
    mocks.loadFromFirestore.mockResolvedValue(cloud);
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toContain(
      'theirs'
    );
  });
});
