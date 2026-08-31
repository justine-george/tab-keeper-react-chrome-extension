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
import { makeTestStore } from '../setup/makeStore';
import {
  TOMBSTONE_MAX,
  TOMBSTONE_TTL_MS,
} from '../../utils/functions/mergeTabData';
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

const ids = (c: TabMasterContainer) =>
  c.tabGroups.map((g) => g.tabGroupId).sort();

async function sync(local: TabMasterContainer, cloud: TabMasterContainer) {
  localStorage.setItem('tabContainerData', JSON.stringify(local));
  mocks.loadFromFirestore.mockResolvedValue(cloud);
  const { store } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  mocks.saveToFirestore.mockClear();
  await store.dispatch(syncStateWithFirestore() as never);
  return store;
}

// The thunk passes the real Date.now() to the merge, so the TTL is reached by
// dating the tombstone rather than by waiting - no E2E can age one 30 days.
// These pin the behaviour a user actually experiences at the boundary.
describe('tombstone expiry through the real sync', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  // The spec describes the TTL tradeoff as "a device offline more than 30 days
  // can resurrect a session deleted while it was away". That is right, but it
  // happens in two steps, and the first step is the opposite of resurrection.
  //
  // Step one: while the expired tombstone still outranks the session it is
  // suppressing, it wins the event contest and is then pruned - so the id ends
  // up with no event at all. The session is dropped and the tombstone is not
  // retained. The delete wins one last time.
  it('drops both the session and the tombstone when an expired tombstone still outranks it', async () => {
    const expired = Date.now() - TOMBSTONE_TTL_MS - 60_000;
    const store = await sync(
      {
        lastModified: expired,
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: [{ tabGroupId: 'ancient', deletedAt: expired }],
      },
      {
        lastModified: expired - 5000,
        selectedTabGroupId: null,
        // last touched before it was deleted, so the tombstone still wins
        tabGroups: [group('ancient', expired - 5000)],
        deletedTabGroups: [],
      }
    );

    expect(ids(store.getState().tabContainerDataState)).toEqual([]);
    expect(store.getState().tabContainerDataState.deletedTabGroups).toEqual([]);
  });

  // Step two, and this is where the documented resurrection actually happens:
  // the tombstone is now gone from both sides, so a device that was offline
  // and still holds the session simply re-adds it. Nothing suppresses it any
  // more. The failure reappears data; it never loses any.
  it('lets a long-offline device re-add the session once the tombstone is forgotten', async () => {
    const longAgo = Date.now() - TOMBSTONE_TTL_MS - 60_000;
    const store = await sync(
      {
        // the offline device: still has the session, never saw the delete
        lastModified: longAgo,
        selectedTabGroupId: null,
        tabGroups: [group('ancient', longAgo)],
      },
      {
        // the cloud has since garbage-collected the tombstone
        lastModified: Date.now(),
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: [],
      }
    );

    expect(ids(store.getState().tabContainerDataState)).toEqual(['ancient']);
  });

  it('keeps the session deleted while the tombstone is still inside the TTL', async () => {
    const recent = Date.now() - 60_000;
    const store = await sync(
      {
        lastModified: recent,
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: recent }],
      },
      {
        lastModified: recent - 5000,
        selectedTabGroupId: null,
        tabGroups: [group('gone', recent - 5000)],
        deletedTabGroups: [],
      }
    );

    expect(ids(store.getState().tabContainerDataState)).toEqual([]);
    expect(
      store
        .getState()
        .tabContainerDataState.deletedTabGroups?.map((t) => t.tabGroupId)
    ).toEqual(['gone']);
  });

  // Garbage collection has to settle. An expired tombstone still sitting in
  // the cloud is a real difference, so one cleanup write is correct - but the
  // sync after that must find nothing to do, or expiry becomes a permanent
  // source of writes.
  it('cleans up an expired tombstone in one write, then goes quiet', async () => {
    const expired = Date.now() - TOMBSTONE_TTL_MS - 60_000;
    const stale = (): TabMasterContainer => ({
      lastModified: expired,
      selectedTabGroupId: null,
      tabGroups: [group('keep', expired)],
      deletedTabGroups: [{ tabGroupId: 'ancient', deletedAt: expired }],
    });

    const store = await sync(stale(), stale());
    expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);

    // whatever that write produced is now both sides' state
    const settled = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(settled.deletedTabGroups).toEqual([]);

    mocks.saveToFirestore.mockClear();
    await sync(settled, settled);
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });

  it('caps a runaway tombstone list and still converges', async () => {
    const now = Date.now();
    const many = Array.from({ length: TOMBSTONE_MAX + 40 }, (_, i) => ({
      tabGroupId: `g${i}`,
      deletedAt: now - i * 1000, // g0 newest
    }));

    const store = await sync(
      {
        lastModified: now,
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: many,
      },
      {
        lastModified: now - 1,
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: [],
      }
    );

    const kept = store.getState().tabContainerDataState.deletedTabGroups!;
    expect(kept).toHaveLength(TOMBSTONE_MAX);
    expect(kept.map((t) => t.tabGroupId)).toContain('g0');
    expect(kept.map((t) => t.tabGroupId)).not.toContain(
      `g${TOMBSTONE_MAX + 39}`
    );

    // and the capped result is a fixed point
    const settled = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    mocks.saveToFirestore.mockClear();
    await sync(settled, settled);
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });
});
