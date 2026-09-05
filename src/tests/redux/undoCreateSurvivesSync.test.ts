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
  applyUndoSnapshot,
  deleteTabContainerInternal,
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { redo, undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    createdAt: Date.UTC(2026, 7, 31, 0, 0, 0),
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
        title: 'window',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co/' },
        ],
      },
    ],
  };
}

const ids = (gs: tabContainerData[]) => gs.map((g) => g.tabGroupId).sort();

// KAN-80. The create half of the family undoTombstone.test.ts covers for
// deletes and undoContentSurvivesSync.test.ts covers for edits.
//
// mergeTabContainers unions by tabGroupId. A session present in the cloud but
// absent locally is simply present: absence is not a signal, only a tombstone
// is. Undoing a create removes the session locally and writes no tombstone, so
// the copy auto-sync pushed up on creation unions straight back.
//
// Measured live on the built extension before this was written: the session
// disappears and returns ~500ms later, and offline it stays gone -- which is
// what proves the merge is the thing reversing it rather than a broken undo.
describe('undoing a create survives the next sync (KAN-80)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps a session the user undid creating out of the merged result', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('existing')));
    store.dispatch(saveToTabContainerInternal(group('created-here')));

    // The cloud received the create, exactly as auto-sync would have pushed it.
    const cloudAfterCreate = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(ids(cloudAfterCreate.tabGroups)).toEqual([
      'created-here',
      'existing',
    ]);

    store.dispatch(undo());

    // The undo itself works -- this is not where the defect is. Without this
    // control a merged result missing the session could mean the fixture never
    // created it.
    const afterUndo = store.getState().tabContainerDataState;
    expect(ids(afterUndo.tabGroups)).toEqual(['existing']);

    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    mocks.loadFromFirestore.mockResolvedValue(cloudAfterCreate);
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'existing',
    ]);
  });

  // The withdrawal is worthless if it stays on this device: the other device
  // still holds the session and would union it back for everyone.
  it('pushes the withdrawal to the cloud', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('created-here')));
    const cloudAfterCreate = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());

    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(store.getState().tabContainerDataState)
    );
    mocks.loadFromFirestore.mockResolvedValue(cloudAfterCreate);
    await store.dispatch(syncStateWithFirestore() as never);

    const calls = mocks.saveToFirestore.mock.calls;
    const written = calls[calls.length - 1]?.[1] as
      | { deletedTabGroups?: { tabGroupId: string }[] }
      | undefined;
    expect(written?.deletedTabGroups?.map((g) => g.tabGroupId)).toContain(
      'created-here'
    );
  });

  // An undo has to be as reversible as the thing it undoes. Redo restores the
  // snapshot that still contains the session, and that snapshot's tombstone
  // list predates the withdrawal -- so the tombstone is dropped and the
  // session is stamped past it by the existing reconcile.
  it('redo brings the session back and lifts its tombstone', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('created-here')));
    store.dispatch(undo());
    expect(
      (store.getState().tabContainerDataState.deletedTabGroups ?? []).map(
        (g) => g.tabGroupId
      )
    ).toContain('created-here');

    store.dispatch(redo());

    const after = store.getState().tabContainerDataState;
    expect(ids(after.tabGroups)).toEqual(['created-here']);
    expect(
      (after.deletedTabGroups ?? []).map((g) => g.tabGroupId)
    ).not.toContain('created-here');
  });

  // CONTROL. The opposite outcome from the same action, so this cannot be
  // "fixed" by making undo delete things in general: undoing a DELETE must
  // still resurrect. If both tests can pass only one way, the fix is wrong.
  it('undoing a delete still resurrects the session', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('doomed')));
    store.dispatch(deleteTabContainerInternal('doomed'));
    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([]);

    store.dispatch(undo());

    const after = store.getState().tabContainerDataState;
    expect(ids(after.tabGroups)).toEqual(['doomed']);
    expect(
      (after.deletedTabGroups ?? []).map((g) => g.tabGroupId)
    ).not.toContain('doomed');
  });

  // The KAN-83 shape, run against the fix rather than the revert: a session
  // this device never created is in the container at undo time. The previous
  // two attempts could not tell it apart from the retracted one and tombstoned
  // it, deleting it on the device that made it. Here the withdrawal names one
  // id, so there is nothing to tell apart.
  it('withdraws only the created session, not one that arrived from another device', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('mine')));

    // Another device's session arrives on a sync.
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
    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'mine',
      'theirs',
    ]);

    // Now create one here and undo it, with the foreign session present.
    store.dispatch(saveToTabContainerInternal(group('created-here')));
    store.dispatch(undo());

    const graves = (
      store.getState().tabContainerDataState.deletedTabGroups ?? []
    ).map((g) => g.tabGroupId);
    expect(graves).toContain('created-here');
    expect(graves).not.toContain('theirs');
    expect(graves).not.toContain('mine');
  });

  // The ordering the bug was actually reported in, and the one measured live:
  // create, let auto-sync finish, THEN undo. The sync is what makes it hard --
  // syncStateWithFirestore dispatches setPresentStartup, which replaces
  // `present` wholesale. Anything recorded on the pending step has to survive
  // that, or the withdrawal disarms in exactly the case the user hits.
  //
  // This is also the fixture that has teeth against the KAN-83 mistake:
  // setPresentStartup refreshes `present` but never `past`, so a snapshot
  // popped here predates the arrival of 'theirs' and a diff-based rule
  // tombstones it. Ordering the sync before the undone step -- as an earlier
  // draft of this file did -- hides that entirely.
  it('still withdraws when a sync lands between the create and the undo', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('mine')));
    store.dispatch(saveToTabContainerInternal(group('created-here')));

    // Auto-sync pushes the create up, and another device's session comes back.
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
    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'created-here',
      'mine',
      'theirs',
    ]);

    store.dispatch(undo());

    const graves = (
      store.getState().tabContainerDataState.deletedTabGroups ?? []
    ).map((g) => g.tabGroupId);
    expect(graves).toContain('created-here');
    expect(graves).not.toContain('theirs');
    expect(graves).not.toContain('mine');

    // And it stays retracted through the merge that follows.
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(store.getState().tabContainerDataState)
    );
    mocks.loadFromFirestore.mockResolvedValue(cloud);
    await store.dispatch(syncStateWithFirestore() as never);
    const after = ids(store.getState().tabContainerDataState.tabGroups);
    expect(after).not.toContain('created-here');
    expect(after).toContain('theirs');
  });

  // Undoing twice in a row. The second undo restores a snapshot older than the
  // first undo's tombstone, and restoreContainer rebuilt deletedTabGroups
  // wholly from the payload -- so that tombstone was thrown away and the
  // session it withdrew came back on the next merge (KAN-81).
  //
  // KAN-81 was filed as display-only, and on `main` it is: a discarded
  // tombstone is restored from the cloud on the same sync, and nothing else
  // depended on it. Once undo writes tombstones of its own that stops being
  // true, because the tombstone IS the retraction. Same defect, promoted from
  // a false toast to a lost undo.
  it('keeps both withdrawals when the user undoes twice', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('keep')));
    store.dispatch(saveToTabContainerInternal(group('first')));
    store.dispatch(saveToTabContainerInternal(group('second')));

    const cloudWithBoth = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    store.dispatch(undo());
    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'keep',
    ]);

    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(store.getState().tabContainerDataState)
    );
    mocks.loadFromFirestore.mockResolvedValue(cloudWithBoth);
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'keep',
    ]);
  });

  // The reducer's own contract, exercised directly because the middleware
  // cannot currently produce this call: a step's recorded ids are by
  // construction absent from the snapshot taken before that step.
  //
  // It is still worth enforcing rather than assuming. `withdrawTabGroupIds` is
  // an argument, and the cost of getting it wrong is asymmetric -- burying a
  // session the snapshot still holds deletes something the user can see, on
  // every device, with no undo left to reach for.
  it('never buries a session the snapshot still contains', () => {
    const { store } = makeTestStore();
    store.dispatch(saveToTabContainerInternal(group('kept')));

    const snapshot = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(
      applyUndoSnapshot({ snapshot, withdrawTabGroupIds: ['kept'] })
    );

    const after = store.getState().tabContainerDataState;
    expect(ids(after.tabGroups)).toEqual(['kept']);
    expect(
      (after.deletedTabGroups ?? []).map((g) => g.tabGroupId)
    ).not.toContain('kept');
  });

  // Creating a session selects it, so reaching for any other row before
  // undoing is ordinary. Selection replaces `present` without recording a
  // step; if that dropped the recorded ids the withdrawal would silently
  // disarm and the bug would look exactly as reported.
  it('still withdraws after the user selects another session first', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('existing')));
    store.dispatch(saveToTabContainerInternal(group('created-here')));
    const cloudAfterCreate = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(selectTabContainer('existing'));
    store.dispatch(undo());

    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(store.getState().tabContainerDataState)
    );
    mocks.loadFromFirestore.mockResolvedValue(cloudAfterCreate);
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState.tabGroups)).toEqual([
      'existing',
    ]);
  });
});
