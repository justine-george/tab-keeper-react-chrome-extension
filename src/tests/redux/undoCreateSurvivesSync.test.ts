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
  deleteTabContainerInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { redo, undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// The third way a sync can reverse an undo, and the one nothing covered.
//
// undoTombstone.test.ts covers undoing a DELETE, and KAN-55 covers undoing an
// EDIT. Both work because restoreContainer stamps sessions that appear in the
// undo payload so they outrank the tombstone or the edit they are superseding.
//
// Undoing a CREATE is not like either. The session is not in the payload at
// all -- the snapshot predates it -- so there is nothing to stamp, and nothing
// writes a tombstone. mergeTabContainers unions by tabGroupId and treats
// absence as no signal, so the cloud's copy is simply "present" and comes
// straight back. Reported from the live extension: the session vanishes, then
// reappears with "Synced changes from another device".

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

describe('undoing a session you just created survives the next sync', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  // The reported reproduction, step for step: open (a session already exists
  // and is in the cloud), create a second one, let it sync, then undo.
  it('does not bring the session back', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('existing')));
    store.dispatch(saveToTabContainerInternal(group('brand-new')));

    // The sync in step 2 pushed the new session up, so the cloud holds both.
    const cloudAfterCreate = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(ids(cloudAfterCreate.tabGroups)).toEqual(['brand-new', 'existing']);

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    // The undo itself works. It is the sync afterwards that reverses it.
    expect(ids(afterUndo.tabGroups)).toEqual(['existing']);

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterCreate);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'existing',
    ]);
  });

  // The withdrawal has to reach the cloud, or the next device to sync brings
  // the session back for everyone.
  it('and tells the cloud, so another device does not resurrect it', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('existing')));
    store.dispatch(saveToTabContainerInternal(group('brand-new')));
    const cloudAfterCreate = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterCreate);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    const tombstones =
      store.getState().tabContainerDataState.deletedTabGroups ?? [];
    expect(tombstones.map((t) => t.tabGroupId)).toContain('brand-new');
  });

  // Withdrawing on undo must not make the undo one-way. Redo has to bring the
  // session back AND lift the tombstone, or the next sync would delete it again
  // -- turning a fixed bug into a worse one.
  //
  // This is the assertion that keeps the fix honest: the withdrawal is only
  // correct if it is as reversible as the thing it undoes.
  it('leaves redo working, so the undo is not a one-way door', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('existing')));
    store.dispatch(saveToTabContainerInternal(group('brand-new')));

    store.dispatch(undo());
    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'existing',
    ]);

    store.dispatch(redo());

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'brand-new',
      'existing',
    ]);
    // And the withdrawal is lifted: redoing the create must not leave the
    // session buried, or the next sync would delete it again.
    const tombstones =
      store.getState().tabContainerDataState.deletedTabGroups ?? [];
    expect(tombstones.map((t) => t.tabGroupId)).not.toContain('brand-new');
  });

  // CONTROL. Undoing a DELETE must still resurrect, which is the opposite
  // outcome from the same action. If this ever fails, a fix above has been
  // applied by making undo delete things generally rather than by withdrawing
  // only the creation it is undoing.
  it('CONTROL: undoing a delete still brings the session back', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('keep')));
    store.dispatch(saveToTabContainerInternal(group('oops')));
    store.dispatch(deleteTabContainerInternal('oops'));
    const cloudAfterDelete = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterDelete);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'keep',
      'oops',
    ]);
  });
});
