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
  deleteTabContainerInternal,
  replaceState,
} from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string, lastModified: number): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    lastModified,
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

const lastWrite = (): TabMasterContainer | undefined => {
  const calls = mocks.saveToFirestore.mock.calls;
  return calls.length
    ? (calls[calls.length - 1][1] as TabMasterContainer)
    : undefined;
};

// A deletion is only durable if the tombstone reaches the cloud. If the write
// carries the session list without the tombstone, the other device re-adds the
// session on its next merge and the user cannot delete it anywhere - the exact
// zombie-session failure tombstones exist to prevent.
describe('a deletion propagates to the cloud', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('writes the tombstone to Firestore, not just the shortened session list', async () => {
    // Both sides start agreeing on two sessions.
    const both = (): TabMasterContainer => ({
      lastModified: 1000,
      selectedTabGroupId: null,
      tabGroups: [group('keep', 1000), group('doomed', 1000)],
      deletedTabGroups: [],
    });

    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    // Seed Redux and localStorage the way the running app would have: the
    // reducer only records a tombstone for a session it actually holds.
    store.dispatch(replaceState(both()));
    localStorage.setItem('tabContainerData', JSON.stringify(both()));

    // The user deletes a session. The reducer writes localStorage itself.
    store.dispatch(deleteTabContainerInternal('doomed'));

    const localAfterDelete = JSON.parse(
      localStorage.getItem('tabContainerData')!
    ) as TabMasterContainer;
    expect(localAfterDelete.deletedTabGroups?.map((t) => t.tabGroupId)).toEqual(
      ['doomed']
    );

    // The cloud has not heard about the delete yet.
    mocks.loadFromFirestore.mockResolvedValue(both());
    mocks.saveToFirestore.mockClear();

    await store.dispatch(syncStateWithFirestore() as never);

    const written = lastWrite();
    expect(written).toBeDefined();
    expect(written!.tabGroups.map((g) => g.tabGroupId)).toEqual(['keep']);
    expect(written!.deletedTabGroups?.map((t) => t.tabGroupId)).toEqual([
      'doomed',
    ]);
  });
});

// The spec's convergence claim: "Both are false in the steady state, so a
// converged pair of devices is silent and writes nothing." If a sync writes
// the same document forever, every popup open hammers Firestore and burns the
// user's quota against a 1 MiB document.
describe('sync converges', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('does not write again once local and cloud agree', async () => {
    const start = (): TabMasterContainer => ({
      lastModified: 1000,
      selectedTabGroupId: null,
      tabGroups: [group('keep', 1000)],
      deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: 900 }],
    });

    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(start()));
    localStorage.setItem('tabContainerData', JSON.stringify(start()));
    mocks.loadFromFirestore.mockResolvedValue(start());

    // First sync: both sides already agree, so nothing should be written.
    await store.dispatch(syncStateWithFirestore() as never);
    const writesAfterFirst = mocks.saveToFirestore.mock.calls.length;

    // Feed the cloud whatever the first sync produced, then sync again.
    const local = JSON.parse(localStorage.getItem('tabContainerData')!);
    mocks.loadFromFirestore.mockResolvedValue(local);
    await store.dispatch(syncStateWithFirestore() as never);

    expect({
      first: writesAfterFirst,
      total: mocks.saveToFirestore.mock.calls.length,
    }).toEqual({ first: 0, total: 0 });
  });
});
