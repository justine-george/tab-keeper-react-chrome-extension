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
  restoreContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

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

// Undo restores a snapshot taken before the delete, so the session comes back
// with no tombstone locally - but the cloud may already hold the tombstone the
// delete pushed up, and it is newer than the restored session's untouched
// timestamp. Without help the next merge simply re-applies the delete: undo
// appears to work and then silently reverses itself, with no way to recover
// the session. This does not exist on main, where there are no tombstones.
describe('undoing a delete survives the next sync', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('brings the session back and keeps it', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    // Real history: the save path is what creates undo snapshots.
    store.dispatch(saveToTabContainerInternal(group('keep')));
    store.dispatch(saveToTabContainerInternal(group('oops')));

    store.dispatch(deleteTabContainerInternal('oops'));
    // The cloud received the delete, tombstone and all.
    const cloudAfterDelete = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(ids(cloudAfterDelete.tabGroups)).toEqual(['keep']);

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    expect(ids(afterUndo.tabGroups)).toEqual(['keep', 'oops']);

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterDelete);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'keep',
      'oops',
    ]);
  });

  // Undo must withdraw only the delete it is undoing. An earlier delete that
  // is still in the past stack has to stay deleted.
  it('leaves an earlier, un-undone delete alone', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('keep')));
    store.dispatch(saveToTabContainerInternal(group('first')));
    store.dispatch(saveToTabContainerInternal(group('second')));

    store.dispatch(deleteTabContainerInternal('first'));
    store.dispatch(deleteTabContainerInternal('second'));
    const cloudAfterBoth = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    // undo only the second delete
    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterBoth);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    const final = store.getState().tabContainerDataState;
    expect(ids(final.tabGroups)).toEqual(['keep', 'second']);
    expect(final.deletedTabGroups?.map((t) => t.tabGroupId)).toEqual(['first']);
  });
});

// The import path restores a container the user is explicitly asserting, so it
// has the same problem as undo: a backup written before a session was deleted
// still contains it and carries no tombstone, while the cloud may still hold
// the one that delete pushed up. On main an import restores everything;
// tombstones broke that, and the import is the newer user action so it wins.
describe('importing a backup that predates a delete', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('restores the deleted session and keeps it through the next sync', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(saveToTabContainerInternal(group('keep')));
    store.dispatch(saveToTabContainerInternal(group('archived')));

    store.dispatch(deleteTabContainerInternal('archived'));
    const cloud = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(ids(cloud.tabGroups)).toEqual(['keep']);

    // an older export file: contains the session, has no deletedTabGroups
    store.dispatch(
      restoreContainer({
        lastModified: Date.now(),
        selectedTabGroupId: null,
        tabGroups: [group('keep'), group('archived')],
      })
    );
    const imported = store.getState().tabContainerDataState;
    expect(ids(imported.tabGroups)).toEqual(['archived', 'keep']);

    mocks.loadFromFirestore.mockResolvedValue(cloud);
    localStorage.setItem('tabContainerData', JSON.stringify(imported));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'archived',
      'keep',
    ]);
  });
});
