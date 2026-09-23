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
import {
  declineCloudConsent,
  grantCloudConsent,
} from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../utils/functions/local';

type Store = ReturnType<typeof makeTestStore>['store'];

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

// Signed in, one session ('local') seeded, and past the first sync -- so the
// both-sides branch's `!hasSyncedBefore` path is not what is under test here.
// D12 is about a merge that changes local data, not about a first sync.
const readyStore = () => {
  vi.setSystemTime(T0);
  const { store, seen } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  store.dispatch(
    replaceState(buildContainer([buildSession({ tabGroupId: 'local' })]))
  );
  store.dispatch(setHasSyncedBefore());
  return { store, seen };
};

// No `!` and no untyped JSON.parse: loadFromLocalStorage returns `unknown`,
// and isValidTabMasterContainer narrows it. Throwing on an invalid read is
// correct here -- every test that calls this has just written the container,
// so a failure means the fixture itself is broken, not that "no data" is a
// valid outcome to silently paper over.
function readLocalStorageContainer(): TabMasterContainer {
  const data = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(data)) {
    throw new Error(
      'tabContainerData in localStorage is not a valid TabMasterContainer'
    );
  }
  return data;
}

// Two devices, never an echo: built from what localStorage actually holds,
// plus a 'remote' session that only the cloud has. Local has nothing the
// cloud lacks with this fixture alone -- see seedTwoSidedDivergence below for
// the fixture where each side holds something the other doesn't.
const cloudWithRemote = (): TabMasterContainer => {
  const local = structuredClone(readLocalStorageContainer());
  return {
    ...local,
    tabGroups: [
      ...local.tabGroups,
      buildSession({ tabGroupId: 'remote', title: 'From laptop' }),
    ],
  };
};

// A genuinely two-sided merge: the cloud is snapshotted with 'remote' FIRST,
// then 'local' is renamed -- so the cloud's copy of 'local' is now stale (it
// lacks the rename) at the same time local lacks 'remote'. Order matters:
// snapshotting the cloud AFTER the rename would make the cloud a strict
// superset of local again, and "saveToFirestore not called while held" would
// be vacuously true whether or not the hold worked, because nothing would
// have written regardless.
const seedTwoSidedDivergence = (store: Store): void => {
  mocks.cloud.doc = cloudWithRemote();
  store.dispatch(
    updateTabGroupTitle({ tabGroupId: 'local', editableTitle: 'Edited' })
  );
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

  // A. A two-sided fixture, so "nothing written while held" is not vacuous:
  // the inline path WOULD write (changedFromCloud is true), and the hold has
  // to be what stops it.
  describe('A: writes nothing while held, writes once released, loses nothing', () => {
    it('a two-sided merge writes nothing while a row is held', async () => {
      const { store } = readyStore();
      seedTwoSidedDivergence(store);
      const before = store.getState().tabContainerDataState;
      beginDragHold();

      await store.dispatch(syncStateWithFirestore());

      expect(mocks.saveToFirestore).not.toHaveBeenCalled();
      expect(store.getState().tabContainerDataState).toEqual(before);
      // The thunk's own pending set this, and the held branch returns before
      // any case that would move it off 'loading'.
      expect(store.getState().globalState.syncStatus).toBe('loading');

      endDragHold();
      await vi.runAllTimersAsync();

      // applyHeldCloudMerge re-syncs once it applies; that re-sync must
      // settle -- a spinner stuck on 'loading' after the drop is a defect.
      expect(store.getState().globalState.syncStatus).not.toBe('loading');
    });

    // CONTROL: the same real divergence, not held, writes as today. Without
    // this, a version of A's first test that always passes (e.g. a stray
    // early return) would go unnoticed.
    it('CONTROL: the same two-sided merge writes when the row is not held', async () => {
      const { store } = readyStore();
      seedTwoSidedDivergence(store);

      await store.dispatch(syncStateWithFirestore());

      expect(mocks.saveToFirestore).toHaveBeenCalled();
    });

    it('after the drop, the re-sync writes a payload with both sides (no data loss)', async () => {
      const { store } = readyStore();
      seedTwoSidedDivergence(store);
      beginDragHold();
      await store.dispatch(syncStateWithFirestore());

      endDragHold();
      await vi.runAllTimersAsync();

      const { calls } = mocks.saveToFirestore.mock;
      const lastCall = calls[calls.length - 1];
      if (lastCall === undefined) {
        throw new Error('saveToFirestore was never called after the drop');
      }
      const [, payload] = lastCall;
      if (!isValidTabMasterContainer(payload)) {
        throw new Error(
          'saveToFirestore payload is not a valid TabMasterContainer'
        );
      }
      const ids = payload.tabGroups.map((g) => g.tabGroupId);
      expect(ids).toContain('remote');
      expect(
        payload.tabGroups.find((g) => g.tabGroupId === 'local')?.title
      ).toBe('Edited');
    });
  });

  // B. applyHeldCloudMerge's two unpinned behaviours: it must show the same
  // toast the inline path shows, and it must merge against localStorage as it
  // is at apply time, not the stale copy captured when the hold began.
  describe('B: the toast, and merging with localStorage as it is NOW', () => {
    it('shows the SYNC_MERGED toast once the drag ends', async () => {
      const { store } = readyStore();
      mocks.cloud.doc = cloudWithRemote();
      beginDragHold();
      await store.dispatch(syncStateWithFirestore());

      endDragHold();

      expect(store.getState().globalState.toastText).toBe(
        TOAST_MESSAGES.SYNC_MERGED
      );
      expect(store.getState().globalState.isToastOpen).toBe(true);
    });

    it('merges with what localStorage holds at apply time, not just the held merge', async () => {
      const { store } = readyStore();
      mocks.cloud.doc = cloudWithRemote();
      beginDragHold();
      await store.dispatch(syncStateWithFirestore());

      // Another page wrote directly to localStorage while the row was held.
      const priorLocal = readLocalStorageContainer();
      const withOtherPage: TabMasterContainer = {
        ...priorLocal,
        tabGroups: [
          ...priorLocal.tabGroups,
          buildSession({ tabGroupId: 'other-page', title: 'From another tab' }),
        ],
      };
      saveToLocalStorage('tabContainerData', withOtherPage);

      endDragHold();

      const ids = store
        .getState()
        .tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
      expect(ids).toContain('remote');
      expect(ids).toContain('other-page');
    });
  });

  // C. KAN-149: a session arriving while held is still a value moment, judged
  // the same way the inline path judges it -- against what localStorage held
  // right before the merge.
  it('C: a session arriving while held still records a KAN-149 value moment', async () => {
    const { store } = readyStore();
    mocks.cloud.doc = cloudWithRemote();
    expect(store.getState().settingsDataState.lastValueMomentTime).toBe('');
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());

    endDragHold();

    expect(typeof store.getState().settingsDataState.lastValueMomentTime).toBe(
      'number'
    );
  });

  // D. KAN-290: the re-sync applyHeldCloudMerge starts after the drop must
  // pass the same gate every other sync starter waits on. If sign-in or
  // consent was withdrawn while the row was held, it must not fire.
  it('D: the re-sync after the drop waits for auth like any sync starter', async () => {
    const { store, seen } = readyStore();
    mocks.cloud.doc = cloudWithRemote();
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());
    expect(
      seen.filter((t) => t === 'global/syncStateWithFirestore/pending')
    ).toHaveLength(1);

    // Consent withdrawn while the row is still held.
    store.dispatch(declineCloudConsent());
    endDragHold();

    expect(
      seen.filter((t) => t === 'global/syncStateWithFirestore/pending')
    ).toHaveLength(1); // no second sync started
  });

  // E. The no-drag pin, in THIS file: without a held row, a changedFromLocal
  // merge is applied inline, not detoured through applyHeldCloudMerge.
  it('E: without a held row, a merge applies inline with exactly one sync', async () => {
    const { store } = readyStore();
    mocks.cloud.doc = cloudWithRemote();

    await store.dispatch(syncStateWithFirestore());

    expect(mocks.loadFromFirestore).toHaveBeenCalledTimes(1);
    expect(store.getState().globalState.syncStatus).toBe('success');
    expect(store.getState().globalState.toastText).toBe(
      TOAST_MESSAGES.SYNC_MERGED
    );
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toContain('remote');
  });

  it('it is applied when the drag ends, and undo is reset', async () => {
    const { store } = readyStore();
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'local', editableTitle: 'Edited' })
    );
    mocks.cloud.doc = cloudWithRemote();
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());

    endDragHold();
    await vi.runAllTimersAsync();

    const ids = store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
    expect(ids).toContain('remote');
    expect(store.getState().undoRedo.past).toEqual([]);
    expect(
      readLocalStorageContainer().tabGroups.map((g) => g.tabGroupId)
    ).toContain('remote');
    expect(store.getState().globalState.syncStatus).not.toBe('loading');
  });

  // CONTROL: a merge that changed nothing is applied as today, drag or not --
  // the hold only ever intercepts a merge that changed local data.
  it('CONTROL: a merge that changed nothing is applied as today, drag or not', async () => {
    const { store } = readyStore();
    mocks.cloud.doc = structuredClone(store.getState().tabContainerDataState);
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());
    expect(store.getState().globalState.syncStatus).toBe('success');
  });
});
