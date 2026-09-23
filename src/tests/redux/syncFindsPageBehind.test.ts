import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// A cloud that holds what was last written to it.
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
  setAutoSync,
} from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup, undo } from '../../redux/slices/undoRedoSlice';
import {
  applyOtherPageSessions,
  hydrateSessionsFromStorage,
} from '../../redux/otherPageChanges';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { dropOnTop } from '../../redux/dropOnTop';
import { sessionDrop } from '../../redux/dropSpecs';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// KAN-295. With several open pages (KAN-279 D9), localStorage can hold
// another page's write that this page has not taken in yet: its storage event
// is queued behind a drag hold, or has not fired. A sync that judged "did
// local data change?" against localStorage alone then saw nothing, and loaded
// that write without holding it for the drag or resetting undo -- so the list
// moved under the pointer, and Ctrl+Z reversed the other page's change
// everywhere. The sync must judge against THIS page too.

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const MIN = 60_000;

type Store = ReturnType<typeof makeTestStore>['store'];

const session = (id: string, title: string): tabContainerData =>
  buildSession({ tabGroupId: id, title, lastModified: T0 - 10 * MIN });

const readStored = (): TabMasterContainer => {
  const data = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(data)) {
    throw new Error('tabContainerData in localStorage is not a container');
  }
  return data;
};

// This page: signed in, a and b loaded (its placeholder has ended), past its
// first sync. setPresentStartup mirrors App's boot, so undo starts at the load.
const openPage = (): Store => {
  vi.setSystemTime(T0);
  const { store } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  const loaded = buildContainer([session('a', 'A'), session('b', 'B')]);
  store.dispatch(replaceState(loaded));
  store.dispatch(setPresentStartup({ tabContainerDataState: loaded }));
  store.dispatch(setHasSyncedBefore());
  return store;
};

// One undo step of this page's own.
const thisPageRenames = (store: Store, id: string, title: string) => {
  vi.setSystemTime(T0 + MIN);
  store.dispatch(updateTabGroupTitle({ tabGroupId: id, editableTitle: title }));
};

// The cloud is up to date with this device: it holds exactly what this page
// last wrote, so the cloud brings nothing localStorage lacks.
const cloudHoldsThisDevice = () => {
  mocks.cloud.doc = structuredClone(readStored());
};

// Another open page, a real store on the same localStorage: it opened on what
// localStorage holds and renamed a session. Its storage event is NOT
// dispatched here -- each test decides whether this page has heard of it.
const otherPageRenames = (id: string, title: string) => {
  vi.setSystemTime(T0 + 2 * MIN);
  const other = makeTestStore().store;
  other.dispatch(replaceState(readStored()));
  other.dispatch(updateTabGroupTitle({ tabGroupId: id, editableTitle: title }));
  vi.setSystemTime(T0 + 3 * MIN);
};

// PREMISE of every test here: the merge changes nothing localStorage holds,
// so `changedFromLocal` is false and only THIS page is behind. Without it the
// tests would pass on the old code's cloud-change path.
const expectOnlyThisPageBehind = () => {
  const cloud = mocks.cloud.doc;
  if (cloud !== undefined && !isValidTabMasterContainer(cloud)) {
    throw new Error('the cloud fixture is not a container');
  }
  if (cloud !== undefined) {
    expect(
      mergeTabContainers(readStored(), cloud, Date.now()).changedFromLocal
    ).toBe(false);
  }
};

const titleOf = (store: Store, id: string) =>
  store
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id)?.title;

const ids = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

// What an undo could reverse, and whether the sync said a device changed it.
const undoAndToast = (store: Store) => {
  const { undoRedo, globalState } = store.getState();
  return {
    past: undoRedo.past.length,
    a: titleOf(store, 'a'),
    mergedToast:
      globalState.isToastOpen &&
      globalState.toastText === TOAST_MESSAGES.SYNC_MERGED,
  };
};

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

describe('a sync that finds this page behind another page resets undo (KAN-295)', () => {
  it("P2: the sync runs before the storage event: undo is reset, a keeps the other page's rename, no toast", async () => {
    const store = openPage();
    thisPageRenames(store, 'b', 'Mine');
    expect(store.getState().undoRedo.past.length).toBe(1);
    cloudHoldsThisDevice();
    otherPageRenames('a', 'Other page');
    expectOnlyThisPageBehind();

    await store.dispatch(syncStateWithFirestore());

    expect(undoAndToast(store)).toEqual({
      past: 0,
      a: 'Other page',
      mergedToast: false,
    });
    // And Ctrl+Z cannot reverse the other page's rename.
    store.dispatch(undo());
    expect(titleOf(store, 'a')).toBe('Other page');
  });

  it('CONTROL: the storage event is handled first, then the sync: the same result', async () => {
    const store = openPage();
    thisPageRenames(store, 'b', 'Mine');
    cloudHoldsThisDevice();
    otherPageRenames('a', 'Other page');
    expectOnlyThisPageBehind();
    store.dispatch(hydrateSessionsFromStorage());

    await store.dispatch(syncStateWithFirestore());

    expect(undoAndToast(store)).toEqual({
      past: 0,
      a: 'Other page',
      mergedToast: false,
    });
    store.dispatch(undo());
    expect(titleOf(store, 'a')).toBe('Other page');
  });

  it("CONTROL: a sync that finds this page level with localStorage leaves this page's undo", async () => {
    const store = openPage();
    thisPageRenames(store, 'b', 'Mine');
    cloudHoldsThisDevice();

    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().undoRedo.past.length).toBe(1);
    expect(store.getState().globalState.syncStatus).toBe('success');
  });

  it('local only (no document yet): the sync finds this page behind, and undo is reset', async () => {
    const store = openPage();
    thisPageRenames(store, 'b', 'Mine');
    otherPageRenames('a', 'Other page');

    await store.dispatch(syncStateWithFirestore());

    // The branch did run: it writes the local copy up.
    expect(mocks.saveToFirestore).toHaveBeenCalled();
    expect(undoAndToast(store)).toEqual({
      past: 0,
      a: 'Other page',
      mergedToast: false,
    });
    store.dispatch(undo());
    expect(titleOf(store, 'a')).toBe('Other page');
  });

  it("CONTROL: local only, level with localStorage: this page's undo survives", async () => {
    const store = openPage();
    thisPageRenames(store, 'b', 'Mine');

    await store.dispatch(syncStateWithFirestore());

    expect(mocks.saveToFirestore).toHaveBeenCalled();
    expect(store.getState().undoRedo.past.length).toBe(1);
  });
});

describe('a sync that finds this page behind holds it for a drag (KAN-295)', () => {
  // Two ways the other page's write can be missing from this page when the
  // sync runs: its storage event has not fired, or it fired and is queued
  // behind the hold (applyOtherPageSessions).
  const routes: [string, (store: Store) => void][] = [
    ['its storage event has not fired', () => {}],
    [
      'its storage event is queued behind the hold',
      (store) => store.dispatch(applyOtherPageSessions()),
    ],
  ];
  it.each(routes)(
    'P1 (%s): the list does not change under the pointer; the drop takes the change in, and undo reverses only the drop',
    async (_, eventReachesThisPage) => {
      const store = openPage();
      cloudHoldsThisDevice();
      beginDragHold();
      otherPageRenames('a', 'Other page');
      eventReachesThisPage(store);
      expectOnlyThisPageBehind();

      await store.dispatch(syncStateWithFirestore());

      // Held: nothing moved under the pointer.
      expect(titleOf(store, 'a')).toBe('A');
      expect(ids(store)).toEqual(['a', 'b']);

      // b dropped above a; RowDragArea.finish then ends the hold.
      store.dispatch(dropOnTop(sessionDrop('b', 0)));
      endDragHold();

      expect(titleOf(store, 'a')).toBe('Other page');
      expect(ids(store)).toEqual(['b', 'a']);
      // No device changed anything: the other page did.
      expect(undoAndToast(store).mergedToast).toBe(false);
      // The drop is the one step on top of the reset.
      expect(store.getState().undoRedo.past.length).toBe(1);
      // Not 'loading' -- but only because the drop's own edit sets 'idle',
      // whether or not the held sync ever ran, and with Auto Sync on that edit
      // syncs anyway. That the held sync itself re-runs is KAN-297's A2.
      expect(store.getState().globalState.syncStatus).not.toBe('loading');

      store.dispatch(undo());
      expect(ids(store)).toEqual(['a', 'b']);
      expect(titleOf(store, 'a')).toBe('Other page');
    }
  );
});

// KAN-297. The held run returns before it settles syncStatus off 'loading',
// and before the save it would have made. A change only another page made has
// nothing of the cloud's to apply at the drop, but the sync itself still has
// to finish once the row is released -- or Sync now stays disabled, and with
// Auto Sync off nothing sends what this sync found until the next sync.
describe('a sync held only because this page is behind still finishes once released (KAN-297)', () => {
  // The cloud lacks the other page's rename: localStorage holds it and the
  // cloud does not, so this sync owes the cloud a write.
  const heldSyncWhileBehind = async (store: Store) => {
    cloudHoldsThisDevice();
    beginDragHold();
    otherPageRenames('a', 'Other page');
    expectOnlyThisPageBehind();
    await store.dispatch(syncStateWithFirestore());
    expect(store.getState().globalState.syncStatus).toBe('loading');
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  };

  const cloudContainer = (): TabMasterContainer => {
    const cloud = mocks.cloud.doc;
    if (!isValidTabMasterContainer(cloud)) {
      throw new Error('the cloud holds no container');
    }
    return cloud;
  };
  const cloudTitleOf = (id: string) =>
    cloudContainer().tabGroups.find((g) => g.tabGroupId === id)?.title;

  it('A1: a cancelled drag settles the spinner and sends what the sync found', async () => {
    const store = openPage();
    await heldSyncWhileBehind(store);

    // Released with no drop (Esc, or let go where it began).
    endDragHold();
    await vi.runAllTimersAsync();

    expect(store.getState().globalState.syncStatus).toBe('success');
    expect(titleOf(store, 'a')).toBe('Other page');
    expect(cloudTitleOf('a')).toBe('Other page');
  });

  // What KAN-295 promises on this path, pinned after the release: the
  // re-sync takes the other page's write in with an undo reset and no toast.
  // Read before any timer runs: the toast closes itself after 3 s.
  it("A1b: the re-sync after a cancel resets this page's undo and shows no toast", async () => {
    const store = openPage();
    thisPageRenames(store, 'b', 'Mine');
    await heldSyncWhileBehind(store);

    endDragHold();
    await vi.advanceTimersByTimeAsync(0);

    expect(undoAndToast(store)).toEqual({
      past: 0,
      a: 'Other page',
      mergedToast: false,
    });
  });

  it('A2: with Auto Sync off, a drop that lands still sends the sync, drop included', async () => {
    const store = openPage();
    store.dispatch(setAutoSync(false));
    await heldSyncWhileBehind(store);

    store.dispatch(dropOnTop(sessionDrop('b', 0)));
    endDragHold();
    await vi.runAllTimersAsync();

    expect(store.getState().globalState.syncStatus).toBe('success');
    expect(cloudTitleOf('a')).toBe('Other page');
    expect(cloudContainer().tabGroups.map((g) => g.tabGroupId)).toEqual([
      'b',
      'a',
    ]);
  });

  it('A3: consent withdrawn while held: no sync starts, and the spinner still settles', async () => {
    const store = openPage();
    await heldSyncWhileBehind(store);
    expect(mocks.loadFromFirestore).toHaveBeenCalledTimes(1);

    store.dispatch(declineCloudConsent());
    endDragHold();
    await vi.runAllTimersAsync();

    expect(mocks.loadFromFirestore).toHaveBeenCalledTimes(1);
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
    expect(store.getState().globalState.syncStatus).toBe('idle');
  });
});
