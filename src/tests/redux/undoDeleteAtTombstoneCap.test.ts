import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// A cloud that holds what was last written to it: saveToFirestore updates it
// in place, so a later read never sees a stale snapshot from before this
// test's own write.
const mocks = vi.hoisted(() => {
  const cloud: { doc: unknown } = { doc: undefined };
  return {
    cloud,
    loadFromFirestore: vi.fn(async (): Promise<unknown> => cloud.doc),
    saveToFirestore: vi.fn(
      async (_userId: string, data: unknown): Promise<void> => {
        cloud.doc = structuredClone(data);
      }
    ),
  };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  ensureCloudSessionReady: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import {
  setFirebaseAuthed,
  setHasSyncedBefore,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import {
  deleteTabContainer,
  replaceState,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup, undo } from '../../redux/slices/undoRedoSlice';
import { TOMBSTONE_MAX } from '../../utils/functions/mergeTabData';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

// 500 pre-existing tombstones this device already carries, all comfortably
// inside the TTL - this is what puts the device AT the tombstone cap before
// its own delete below adds one more.
const priorGraves = Array.from({ length: TOMBSTONE_MAX }, (_, i) => ({
  tabGroupId: `grave-${i}`,
  deletedAt: T0 - 1000 - i,
}));

// Signed in, past the first sync, and seeded with two live sessions plus the
// 500 graves - so the both-sides branch's `!hasSyncedBefore` path is not what
// is under test here. KAN-293 is about a merge that only pruned tombstones,
// not about a first sync.
const readyStore = () => {
  vi.setSystemTime(T0);
  const { store } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  const seeded = {
    ...buildContainer([
      buildSession({ tabGroupId: 's' }),
      buildSession({ tabGroupId: 't' }),
    ]),
    deletedTabGroups: priorGraves,
  };
  store.dispatch(replaceState(seeded));
  // Mirrors App.tsx's boot sequence: replaceState alone leaves `present`
  // stuck at undoRedoSlice's default (empty) initial state, since replaceState
  // isn't a capturable action. Without this, the delete below pushes that
  // stale empty snapshot onto `past` instead of the real pre-delete state,
  // and undo would restore emptiness rather than bring 's' back - a bug in
  // the fixture, not in the code under test.
  store.dispatch(setPresentStartup({ tabContainerDataState: seeded }));
  store.dispatch(setHasSyncedBefore());
  return store;
};

describe('undo survives a sync at the tombstone cap (KAN-293)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.cloud.doc = undefined;
    mocks.saveToFirestore.mockClear();
    mocks.loadFromFirestore.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deleting a session at the cap leaves its undo intact after the sync', async () => {
    const store = readyStore();

    // The cloud is this device's own last write: exactly the pre-delete
    // state, read back from what replaceState just persisted to
    // localStorage - not rebuilt from buildContainer, which could disagree in
    // a field the seed touched and make the premise below false for the
    // wrong reason.
    mocks.cloud.doc = structuredClone(
      JSON.parse(localStorage.getItem('tabContainerData')!)
    );

    vi.setSystemTime(T0 + 1000);
    await store.dispatch(deleteTabContainer('s'));

    expect(
      (store.getState().tabContainerDataState.deletedTabGroups ?? []).map(
        (g) => g.tabGroupId
      )
    ).toContain('s');
    expect(store.getState().undoRedo.past.length).toBeGreaterThan(0);

    vi.setSystemTime(T0 + 2000);
    await store.dispatch(syncStateWithFirestore());

    // PREMISE: the sync must not have wiped the delete's own undo step. On
    // the current code, D12 (KAN-279) treats the tombstone-cap prune as a
    // change from another device and resets history here, so this fails
    // before the fix - the assertion after it is meaningless without this
    // holding.
    expect(store.getState().undoRedo.past.length).toBeGreaterThan(0);

    store.dispatch(undo());

    expect(
      store
        .getState()
        .undoRedo.present.tabContainerDataState.tabGroups.map(
          (g) => g.tabGroupId
        )
    ).toContain('s');
  });
});
