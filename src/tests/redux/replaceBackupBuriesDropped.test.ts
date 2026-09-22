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
  mergeSessionsFromBackupInternal,
  restoreContainer,
  saveToTabContainerInternal,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-262. Replace ("Load sessions from a backup" → Replace sessions) dropped
// every session here that the file did not carry, but wrote no tombstone for
// them. The sync merge unions by id and treats absence as no signal -- only a
// tombstone deletes -- so on any device with Auto Sync on the next sync
// brought the dropped sessions straight back from the cloud, and the dialog's
// "Replace deletes the N sessions on this device" was a promise the code did
// not keep.
//
// Replace means "these and only these", and the user has just confirmed it in
// a dialog, so a session absent from the file is buried: a grave stamped
// strictly after its live copy, which is what makes the deletion win the
// merge and propagate.

const ids = (c: TabMasterContainer) => c.tabGroups.map((g) => g.tabGroupId);
const graveIds = (c: TabMasterContainer) =>
  (c.deletedTabGroups ?? []).map((g) => g.tabGroupId).sort();

const file = (...sessions: ReturnType<typeof buildSession>[]) =>
  buildContainer(sessions);

// saved here: h1 h2 h3, and the cloud holds the same (the boot sync ran).
const seedThree = () => {
  const { store } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  for (const id of ['h1', 'h2', 'h3']) {
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: id }))
    );
  }
  const cloud = JSON.parse(
    JSON.stringify(store.getState().tabContainerDataState)
  ) as TabMasterContainer;
  return { store, cloud };
};

describe('Replace buries the sessions it drops (KAN-262)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('writes a tombstone for every session here that the file does not carry', () => {
    const { store } = seedThree();
    const before = store.getState().tabContainerDataState;

    store.dispatch(
      restoreContainer(
        file(
          buildSession({ tabGroupId: 'f1' }),
          buildSession({ tabGroupId: 'f2' })
        )
      )
    );

    const after = store.getState().tabContainerDataState;
    expect(ids(after)).toEqual(['f1', 'f2']);
    expect(graveIds(after)).toEqual(['h1', 'h2', 'h3']);
    // Strictly after the copy it buries: the merge gives exact ties to the
    // cloud, and a Replace right after a save lands in the same millisecond.
    for (const dropped of before.tabGroups) {
      const grave = after.deletedTabGroups!.find(
        (g) => g.tabGroupId === dropped.tabGroupId
      )!;
      expect(grave.deletedAt).toBeGreaterThan(
        dropped.lastModified ?? before.lastModified
      );
    }
  });

  it('does not bury a session the file still carries', () => {
    const { store } = seedThree();

    store.dispatch(
      restoreContainer(
        file(
          buildSession({ tabGroupId: 'h2' }),
          buildSession({ tabGroupId: 'f1' })
        )
      )
    );

    const after = store.getState().tabContainerDataState;
    expect(ids(after)).toEqual(['h2', 'f1']);
    expect(graveIds(after)).toEqual(['h1', 'h3']);
  });

  // The defect as reproduced on 2026-09-21: after Replace the list showed the
  // file's sessions, then the sync put the originals back. The next sync
  // against a cloud still holding h1 h2 h3 must leave them gone, and the
  // document it writes must carry their graves so the other devices drop
  // them too.
  it('the dropped sessions stay gone through the next sync, and the cloud learns why', async () => {
    const { store, cloud } = seedThree();

    store.dispatch(
      restoreContainer(
        file(
          buildSession({ tabGroupId: 'f1' }),
          buildSession({ tabGroupId: 'f2' })
        )
      )
    );
    const replaced = store.getState().tabContainerDataState;
    localStorage.setItem('tabContainerData', JSON.stringify(replaced));
    mocks.loadFromFirestore.mockResolvedValue(cloud);

    await store.dispatch(syncStateWithFirestore() as never);

    // Membership, not order: the sync merge orders by its own rule.
    expect(ids(store.getState().tabContainerDataState).sort()).toEqual([
      'f1',
      'f2',
    ]);
    expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);
    const written = mocks.saveToFirestore.mock
      .calls[0][1] as TabMasterContainer;
    expect(ids(written).sort()).toEqual(['f1', 'f2']);
    expect(graveIds(written)).toEqual(['h1', 'h2', 'h3']);
  });

  // CONTROL. Merge in the same setup is additive and buries nothing; the
  // sync then unions, as it should. Without this the assertions above would
  // pass against a reducer that buried everything on every load.
  it('CONTROL: Merge in the same setup buries nothing and the sync unions', async () => {
    const { store, cloud } = seedThree();

    store.dispatch(
      mergeSessionsFromBackupInternal(
        file(
          buildSession({ tabGroupId: 'f1' }),
          buildSession({ tabGroupId: 'f2' })
        )
      )
    );
    const merged = store.getState().tabContainerDataState;
    expect(graveIds(merged)).toEqual([]);
    localStorage.setItem('tabContainerData', JSON.stringify(merged));
    mocks.loadFromFirestore.mockResolvedValue(cloud);

    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store.getState().tabContainerDataState).sort()).toEqual([
      'f1',
      'f2',
      'h1',
      'h2',
      'h3',
    ]);
  });
});
