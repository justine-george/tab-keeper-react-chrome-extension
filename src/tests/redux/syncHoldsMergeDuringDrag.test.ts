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
import { beginDragHold, endDragHold } from '../../redux/dragHold';
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

// Two devices, never an echo: built from what localStorage actually holds
// (replaceState above already wrote it, and a rename writes it again), plus a
// 'remote' session that only the cloud has.
const cloudWithRemote = (): TabMasterContainer => {
  const local = structuredClone(
    JSON.parse(localStorage.getItem('tabContainerData')!)
  ) as TabMasterContainer;
  return {
    ...local,
    tabGroups: [
      ...local.tabGroups,
      buildSession({ tabGroupId: 'remote', title: 'From laptop' }),
    ],
  };
};

describe('the sync holds its merge while a drag is held (D12, KAN-279)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.cloud.doc = undefined;
    mocks.saveToFirestore.mockClear();
    mocks.loadFromFirestore.mockClear();
  });
  afterEach(() => {
    endDragHold();
    vi.useRealTimers();
  });

  it('a merge that changed local data is not applied while a row is held', async () => {
    const store = readyStore();
    mocks.cloud.doc = cloudWithRemote(); // holds session 'remote'
    beginDragHold();

    await store.dispatch(syncStateWithFirestore());

    const ids = store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
    expect(ids).not.toContain('remote');
    expect(mocks.saveToFirestore).not.toHaveBeenCalled(); // the pre-merge state must never be written

    // The thunk's own pending set this, and returning early on the held
    // branch never reaches a case that would move it off 'loading' -- so a
    // held drag leaves the header's spinner showing until the drop.
    expect(store.getState().globalState.syncStatus).toBe('loading');

    endDragHold();
    await vi.runAllTimersAsync();

    // applyHeldCloudMerge re-syncs once it applies; that re-sync must settle
    // -- a spinner stuck on 'loading' after the drop would be a defect.
    expect(store.getState().globalState.syncStatus).not.toBe('loading');
  });

  it('it is applied when the drag ends, and undo is reset', async () => {
    const store = readyStore();
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'local', editableTitle: 'Edited' })
    );
    mocks.cloud.doc = cloudWithRemote();
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());

    endDragHold();

    const ids = store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
    expect(ids).toContain('remote');
    expect(store.getState().undoRedo.past).toEqual([]);
    expect(
      JSON.parse(localStorage.getItem('tabContainerData')!).tabGroups.map(
        (g: { tabGroupId: string }) => g.tabGroupId
      )
    ).toContain('remote');
  });

  // CONTROL: a merge that changed nothing is applied as today, drag or not --
  // the hold only ever intercepts a merge that changed local data.
  it('CONTROL: a merge that changed nothing is applied as today, drag or not', async () => {
    const store = readyStore();
    mocks.cloud.doc = structuredClone(store.getState().tabContainerDataState);
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());
    expect(store.getState().globalState.syncStatus).toBe('success');
  });
});
