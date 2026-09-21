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
  deleteTabContainerInternal,
  mergeSessionsFromBackupInternal,
  saveToTabContainerInternal,
  selectTabContainer,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-261. Merge, the additive answer to "Load sessions from a backup". Its
// promise is "nothing here changes": every session saved here stays as it
// is, and the file's sessions that are not here yet are added on top. The
// three rules that make that promise hold are the three tests below that are
// not the happy path -- a session in both, a session deleted here, and the
// file's own tombstones.
//
// Built on reconcileAssertedContainer, not a new merge rule: the payload is
// everything here plus the file-only sessions, and the reconcile already
// stamps a re-added session past its tombstone and drops the grave.

const ids = (c: TabMasterContainer) => c.tabGroups.map((g) => g.tabGroupId);

const file = (...sessions: ReturnType<typeof buildSession>[]) =>
  buildContainer(sessions);

describe('mergeSessionsFromBackupInternal (KAN-261)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('adds the file-only sessions on top and leaves what is here untouched', () => {
    const { store } = makeTestStore();
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'h1', title: 'Here one' })
      )
    );
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'h2', title: 'Here two' })
      )
    );
    const before = store.getState().tabContainerDataState;

    store.dispatch(
      mergeSessionsFromBackupInternal(
        file(
          buildSession({ tabGroupId: 'f1', title: 'File one' }),
          buildSession({ tabGroupId: 'f2', title: 'File two' })
        )
      )
    );

    const after = store.getState().tabContainerDataState;
    expect(ids(after)).toEqual(['f1', 'f2', 'h2', 'h1']);
    // The local sessions are the same objects, not re-stamped copies: a
    // merge that touched them would assert them over the cloud's copies.
    expect(after.tabGroups[2]).toBe(before.tabGroups[0]);
    expect(after.tabGroups[3]).toBe(before.tabGroups[1]);
    expect(after.lastModified).toBeGreaterThanOrEqual(before.lastModified);
    // Persisted, as every container reducer does.
    expect(
      JSON.parse(localStorage.getItem('tabContainerData')!).tabGroups
    ).toHaveLength(4);
  });

  it('a session in both keeps the copy saved here', () => {
    const { store } = makeTestStore();
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'both', title: 'Here' })
      )
    );

    store.dispatch(
      mergeSessionsFromBackupInternal(
        file(buildSession({ tabGroupId: 'both', title: 'From the file' }))
      )
    );

    const after = store.getState().tabContainerDataState;
    expect(ids(after)).toEqual(['both']);
    expect(after.tabGroups[0].title).toBe('Here');
  });

  it('the selected session stays selected', () => {
    const { store } = makeTestStore();
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: 'h1' }))
    );
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: 'h2' }))
    );
    store.dispatch(selectTabContainer('h1'));

    store.dispatch(
      mergeSessionsFromBackupInternal(file(buildSession({ tabGroupId: 'f1' })))
    );

    const after = store.getState().tabContainerDataState;
    expect(after.selectedTabGroupId).toBe('h1');
    expect(after.tabGroups.find((g) => g.tabGroupId === 'h1')!.isSelected).toBe(
      true
    );
    expect(after.tabGroups.find((g) => g.tabGroupId === 'f1')!.isSelected).toBe(
      false
    );
  });

  // The rule that matters. A session deleted here has a tombstone; re-adding
  // it from the file and leaving the grave lets the next sync delete it again,
  // silently. The user asked for it back.
  it('a session deleted here comes back, and its tombstone goes', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: 'keep' }))
    );
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'gone', title: 'Deleted here' })
      )
    );
    store.dispatch(deleteTabContainerInternal('gone'));
    const buried = store.getState().tabContainerDataState;
    expect(ids(buried)).toEqual(['keep']);
    const grave = buried.deletedTabGroups!.find(
      (g) => g.tabGroupId === 'gone'
    )!;
    expect(grave).toBeDefined();
    // The cloud holds the delete, as auto-sync would have pushed it.
    const cloud = JSON.parse(JSON.stringify(buried));

    store.dispatch(
      mergeSessionsFromBackupInternal(
        file(buildSession({ tabGroupId: 'gone', title: 'Deleted here' }))
      )
    );

    const after = store.getState().tabContainerDataState;
    expect(ids(after)).toEqual(['gone', 'keep']);
    expect(
      (after.deletedTabGroups ?? []).map((g) => g.tabGroupId)
    ).not.toContain('gone');
    const back = after.tabGroups[0];
    expect(back.lastModified).toBeGreaterThan(grave.deletedAt);

    // The discriminating half: the next sync against a cloud that still holds
    // the tombstone must NOT remove it again.
    localStorage.setItem('tabContainerData', JSON.stringify(after));
    mocks.loadFromFirestore.mockResolvedValue(cloud);
    await store.dispatch(syncStateWithFirestore() as never);
    // Membership, not order: the sync merge orders the result by its own
    // rule, and what is under test is that the tombstone did not win.
    expect(ids(store.getState().tabContainerDataState).sort()).toEqual([
      'gone',
      'keep',
    ]);
  });

  // Merge deletes nothing: a tombstone in the FILE for a session that is
  // alive here is a fact about the file, not an instruction.
  it("the file's tombstones delete nothing here", () => {
    const { store } = makeTestStore();
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: 'alive' }))
    );

    store.dispatch(
      mergeSessionsFromBackupInternal({
        ...file(buildSession({ tabGroupId: 'f1' })),
        deletedTabGroups: [
          { tabGroupId: 'alive', deletedAt: Date.now() + 1000 },
        ],
      })
    );

    const after = store.getState().tabContainerDataState;
    expect(ids(after)).toEqual(['f1', 'alive']);
    expect(
      (after.deletedTabGroups ?? []).map((g) => g.tabGroupId)
    ).not.toContain('alive');
  });

  // Merge is additive, so it is undoable where Replace is not: undoing it
  // withdraws exactly the sessions it added (the KAN-80 mechanism) and leaves
  // everything that was here.
  it('undo withdraws the added sessions and nothing else', () => {
    const { store } = makeTestStore();
    store.dispatch(
      saveToTabContainerInternal(buildSession({ tabGroupId: 'h1' }))
    );

    store.dispatch(
      mergeSessionsFromBackupInternal(
        file(
          buildSession({ tabGroupId: 'f1' }),
          buildSession({ tabGroupId: 'f2' })
        )
      )
    );
    expect(ids(store.getState().tabContainerDataState)).toEqual([
      'f1',
      'f2',
      'h1',
    ]);

    store.dispatch(undo());

    const after = store.getState().tabContainerDataState;
    expect(ids(after)).toEqual(['h1']);
    // Withdrawn with tombstones, so a device that received them via sync
    // drops them too rather than unioning them straight back.
    expect(
      (after.deletedTabGroups ?? []).map((g) => g.tabGroupId).sort()
    ).toEqual(['f1', 'f2']);
  });
});
