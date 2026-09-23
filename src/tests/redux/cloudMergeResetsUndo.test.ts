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
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

// Signed in, one session ('local') seeded, and past the first sync -- so the
// both-sides branch's `!hasSyncedBefore` path is not what is under test here.
// D12 is about a merge that changes local data, not about a first sync.
const readyStore = () => {
  vi.setSystemTime(T0);
  const { store } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  store.dispatch(
    replaceState(buildContainer([buildSession({ tabGroupId: 'local' })]))
  );
  store.dispatch(setHasSyncedBefore());
  return store;
};

describe('a cloud merge that changed local data resets undo (D12, KAN-279)', () => {
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

  it("a merge that brings in another device's session resets undo", async () => {
    const store = readyStore(); // signed in, replaceState([local]) seeded, hasSyncedBefore set
    vi.setSystemTime(T0 + 1000);
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'local', editableTitle: 'Edited' })
    );
    vi.setSystemTime(T0 + 2000);
    store.dispatch(
      updateTabGroupTitle({
        tabGroupId: 'local',
        editableTitle: 'Edited again',
      })
    );
    // One undo after two edits, so `future` is non-empty going into the sync
    // too -- resetHistory must clear both stacks, not just `past`.
    vi.setSystemTime(T0 + 3000);
    store.dispatch(undo());
    expect(store.getState().undoRedo.past.length).toBeGreaterThan(0);
    expect(store.getState().undoRedo.future.length).toBeGreaterThan(0);

    // Two devices, never an echo: the cloud's 'local' session must match this
    // device's exactly (same fields and lastModified), so the ONLY difference
    // is 'remote'. Built from what the rename actually stamped into
    // localStorage -- not from buildSession(..., 'Edited'), which could differ
    // in fields the rename touched (contentModified, lastModified) and make
    // 'local' itself look like a change.
    const localAfterRename = structuredClone(
      JSON.parse(localStorage.getItem('tabContainerData')!)
    ) as TabMasterContainer;
    mocks.cloud.doc = {
      ...localAfterRename,
      tabGroups: [
        ...localAfterRename.tabGroups,
        buildSession({ tabGroupId: 'remote', title: 'From laptop' }),
      ],
    };

    vi.setSystemTime(T0 + 4000);
    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().undoRedo.past).toEqual([]);
    expect(store.getState().undoRedo.future).toEqual([]);
    expect(
      store
        .getState()
        .undoRedo.present.tabContainerDataState.tabGroups.map(
          (g) => g.tabGroupId
        )
    ).toContain('remote');
  });

  // CONTROL: a merge that changed nothing locally keeps undo. If this fails
  // after the fix, the fixture isn't in sync -- not a case for weakening the
  // assertion above.
  it('CONTROL: a merge that changed nothing locally keeps undo', async () => {
    const store = readyStore();
    vi.setSystemTime(T0 + 1000);
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'local', editableTitle: 'Edited' })
    );
    const past = store.getState().undoRedo.past.length;
    mocks.cloud.doc = structuredClone(store.getState().tabContainerDataState);

    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().undoRedo.past.length).toBe(past);
  });
});
