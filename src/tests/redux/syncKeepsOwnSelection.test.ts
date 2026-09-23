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
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  saveToTabContainerInternal,
  selectTabContainer,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { hydrateSessionsFromStorage } from '../../redux/otherPageChanges';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// KAN-294. Selection is per page (KAN-279 D9), but every sync path loads the
// container from localStorage, which holds whichever page wrote LAST -- so a
// sync used to hand this page the other page's selection. The first load from
// any source keeps that source's selection (a lone page is unaffected); every
// later load keeps this page's own.

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const MIN = 60_000;

type Store = ReturnType<typeof makeTestStore>['store'];

// Explicit lastModified: the real stored shape, what every merge writes.
const session = (id: string): tabContainerData =>
  buildSession({ tabGroupId: id, title: id, lastModified: T0 - 10 * MIN });

const selecting = (
  container: TabMasterContainer,
  id: string | null
): TabMasterContainer => ({
  ...container,
  selectedTabGroupId: id,
  tabGroups: container.tabGroups.map((g) => ({
    ...g,
    isSelected: g.tabGroupId === id,
  })),
});

const readStored = (): TabMasterContainer => {
  const data = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(data)) {
    throw new Error('tabContainerData in localStorage is not a container');
  }
  return data;
};

// The other page selected `id` and wrote it, and nothing else. No storage
// event is dispatched: the sync is the route under test, not the listener.
const otherPageSelects = (id: string) =>
  localStorage.setItem(
    'tabContainerData',
    JSON.stringify(selecting(readStored(), id))
  );

// What this page shows, and what its undo would restore, as one value: the
// selection and every isSelected flag.
const shown = (store: Store) => {
  const { tabContainerDataState, undoRedo } = store.getState();
  const flags = (c: TabMasterContainer) =>
    c.tabGroups.filter((g) => g.isSelected).map((g) => g.tabGroupId);
  return {
    selected: tabContainerDataState.selectedTabGroupId,
    flagged: flags(tabContainerDataState),
    presentSelected: undoRedo.present.tabContainerDataState.selectedTabGroupId,
    presentFlagged: flags(undoRedo.present.tabContainerDataState),
  };
};

const keeps = (id: string | null) => ({
  selected: id,
  flagged: id === null ? [] : [id],
  presentSelected: id,
  presentFlagged: id === null ? [] : [id],
});

const signedInStore = () => {
  vi.setSystemTime(T0);
  const made = makeTestStore();
  made.store.dispatch(setUserId('u1'));
  made.store.dispatch(setSignedIn());
  made.store.dispatch(setFirebaseAuthed());
  made.store.dispatch(grantCloudConsent());
  return made;
};

// A page that opened, loaded alpha+bravo with alpha selected, and synced:
// that first sync is this page's first load. The cloud echoes it, so the
// load changes nothing but the store.
const openPage = async () => {
  const made = signedInStore();
  const stored = selecting(
    buildContainer([session('alpha'), session('bravo')]),
    'alpha'
  );
  localStorage.setItem('tabContainerData', JSON.stringify(stored));
  mocks.cloud.doc = selecting(stored, null);
  await made.store.dispatch(syncStateWithFirestore());
  // CONTROL: the first load kept the stored selection.
  expect(shown(made.store).selected).toBe('alpha');
  return made;
};

// Another device saved 'remote': the cloud holds something this device
// lacks, so the merge really changes local data (two devices, never an echo).
const cloudGains = () => {
  const cloud = readStored();
  mocks.cloud.doc = {
    ...selecting(cloud, null),
    tabGroups: [...cloud.tabGroups, session('remote')],
  };
};

// Another device deleted alpha after this page last saw it.
const cloudDeletesAlpha = () => {
  const cloud = readStored();
  mocks.cloud.doc = {
    ...selecting(cloud, null),
    tabGroups: cloud.tabGroups.filter((g) => g.tabGroupId !== 'alpha'),
    deletedTabGroups: [{ tabGroupId: 'alpha', deletedAt: T0 - MIN }],
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

describe("a sync keeps this page's own selection (KAN-294)", () => {
  it('site 1, both sides: a merge that changed nothing keeps it', async () => {
    const { store } = await openPage();
    otherPageSelects('bravo');

    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('success');
    expect(shown(store).selected).toBe('alpha');
    expect(shown(store).flagged).toEqual(['alpha']);
  });

  it('site 1, both sides: a merge that brought a session in keeps it, and so does undo', async () => {
    const { store } = await openPage();
    cloudGains();
    otherPageSelects('bravo');

    await store.dispatch(syncStateWithFirestore());

    // The merge did land (resetHistory ran with it).
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toContain('remote');
    expect(shown(store)).toEqual(keeps('alpha'));
  });

  it("site 1: alpha deleted by the cloud falls back to null, not the other page's bravo", async () => {
    const { store } = await openPage();
    cloudDeletesAlpha();
    otherPageSelects('bravo');

    await store.dispatch(syncStateWithFirestore());

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['bravo']);
    expect(shown(store)).toEqual(keeps(null));
  });

  it("site 2, cloud only: the cloud's selection does not replace this page's", async () => {
    const { store } = await openPage();
    // The cloud holds bravo selected (the last device to save chose it), and
    // localStorage is gone, so the sync takes the cloud-only branch.
    mocks.cloud.doc = selecting(readStored(), 'bravo');
    localStorage.removeItem('tabContainerData');

    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('success');
    expect(shown(store).selected).toBe('alpha');
    expect(shown(store).flagged).toEqual(['alpha']);
  });

  it('site 2: alpha missing from the cloud falls back to null, not bravo', async () => {
    const { store } = await openPage();
    mocks.cloud.doc = selecting(
      { ...readStored(), tabGroups: [session('bravo')] },
      'bravo'
    );
    localStorage.removeItem('tabContainerData');

    await store.dispatch(syncStateWithFirestore());

    expect(shown(store).selected).toBe(null);
    expect(shown(store).flagged).toEqual([]);
  });

  it("site 3, local only: the other page's selection does not replace this page's", async () => {
    const { store } = await openPage();
    mocks.cloud.doc = undefined;
    otherPageSelects('bravo');

    await store.dispatch(syncStateWithFirestore());

    expect(shown(store).selected).toBe('alpha');
    expect(shown(store).flagged).toEqual(['alpha']);
  });

  it('site 3: alpha deleted by the other page falls back to null, not bravo', async () => {
    const { store } = await openPage();
    mocks.cloud.doc = undefined;
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(
        selecting({ ...readStored(), tabGroups: [session('bravo')] }, 'bravo')
      )
    );

    await store.dispatch(syncStateWithFirestore());

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['bravo']);
    expect(shown(store).selected).toBe(null);
    expect(shown(store).flagged).toEqual([]);
  });

  it('site 4, a held merge: applied at the drop, it keeps it, and so does undo', async () => {
    const { store } = await openPage();
    cloudGains();
    otherPageSelects('bravo');
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());

    endDragHold();

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toContain('remote');
    expect(shown(store)).toEqual(keeps('alpha'));
  });

  it('site 4: alpha deleted by the cloud falls back to null, not bravo', async () => {
    const { store } = await openPage();
    cloudDeletesAlpha();
    otherPageSelects('bravo');
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());

    endDragHold();

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['bravo']);
    expect(shown(store)).toEqual(keeps(null));
  });
});

describe("the first load keeps its source's selection (KAN-294)", () => {
  it('CONTROL: a lone page opens, syncs, and keeps the stored selection', async () => {
    const { store } = signedInStore();
    const stored = selecting(
      buildContainer([session('alpha'), session('bravo')]),
      'bravo'
    );
    localStorage.setItem('tabContainerData', JSON.stringify(stored));
    mocks.cloud.doc = selecting(stored, null);

    await store.dispatch(syncStateWithFirestore());

    expect(shown(store)).toEqual(keeps('bravo'));
  });

  it("CONTROL: a fresh install, nothing local, keeps the cloud's selection", async () => {
    const { store } = signedInStore();
    mocks.cloud.doc = selecting(
      buildContainer([session('alpha'), session('bravo')]),
      'bravo'
    );

    await store.dispatch(syncStateWithFirestore());

    expect(shown(store)).toEqual(keeps('bravo'));
  });
});

describe('no ping-pong (KAN-294)', () => {
  it("this page's sync writes its selection, and the other page's re-read of it is a no-op", async () => {
    // Page 2 opened on the same data and selected bravo.
    const page2 = signedInStore();
    const stored = selecting(
      buildContainer([session('alpha'), session('bravo')]),
      'bravo'
    );
    localStorage.setItem('tabContainerData', JSON.stringify(stored));
    mocks.cloud.doc = selecting(stored, null);
    await page2.store.dispatch(syncStateWithFirestore());
    // Page 1 opened after it and selected alpha, then page 2 wrote bravo.
    const { store: page1 } = await openPage();
    otherPageSelects('bravo');

    // Page 1 syncs: its replaceState writes localStorage with ITS selection.
    await page1.dispatch(syncStateWithFirestore());
    expect(readStored().selectedTabGroupId).toBe('alpha');

    // The storage event that write fires in page 2 re-reads it: same data,
    // so nothing is dispatched and page 2 keeps bravo.
    const before = page2.store.getState().tabContainerDataState;
    page2.seen.length = 0;
    page2.store.dispatch(hydrateSessionsFromStorage());

    expect(page2.seen).toEqual(['THUNK']);
    expect(page2.store.getState().tabContainerDataState).toBe(before);
    expect(shown(page2.store).selected).toBe('bravo');
  });
});

// Fix round 1. A page that opened on NOTHING (no container in localStorage)
// still holds the slice's placeholder container until something happens to
// it. Three things can, and none of them is a load through a sync or App's
// startup read: another page's sessions arriving through the storage event,
// the sync finding no sessions anywhere, and the page's own first edit. After
// any of them the page's selection is its own, and the next load must keep
// it. Two real stores share one localStorage, as two open pages do.
describe('a page that opened on nothing (KAN-294, fix round 1)', () => {
  // The other page: opened on what localStorage holds -- its own first load
  // -- and then selects `id`, which writes the selection and nothing else.
  const otherPageOpensAndSelects = (id: string) => {
    const other = makeTestStore().store;
    other.dispatch(replaceState(readStored()));
    other.dispatch(selectTabContainer(id));
    expect(readStored().selectedTabGroupId).toBe(id);
  };

  it("(a) sessions taken in from another page: a later sync keeps this page's null, not bravo", async () => {
    const { store } = signedInStore();
    // Another page saved two sessions; the storage event reaches this page.
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(
        selecting(buildContainer([session('alpha'), session('bravo')]), 'alpha')
      )
    );
    store.dispatch(hydrateSessionsFromStorage());
    // CONTROL: the hydrate did take them in, with this page's own (null)
    // selection -- the D9 rule, unchanged.
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['alpha', 'bravo']);
    expect(shown(store).selected).toBe(null);

    otherPageOpensAndSelects('bravo');
    // Same data, so the storage event takes nothing in.
    store.dispatch(hydrateSessionsFromStorage());

    await store.dispatch(syncStateWithFirestore());

    // The load did run: local only, and it wrote the cloud.
    expect(mocks.saveToFirestore).toHaveBeenCalled();
    expect(shown(store).selected).toBe(null);
    expect(shown(store).flagged).toEqual([]);
  });

  it("(b) the sync found no sessions anywhere: a later sync keeps this page's null, not bravo", async () => {
    const { store } = signedInStore();
    await store.dispatch(syncStateWithFirestore());
    await vi.runAllTimersAsync();
    // CONTROL: the new-user branch ran -- it loads nothing, and writes the
    // empty container to the cloud.
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
    expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);

    // Another page saves two sessions and selects bravo. This page's storage
    // event is not dispatched: the sync is the route under test.
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([session('alpha'), session('bravo')]))
    );
    otherPageOpensAndSelects('bravo');

    await store.dispatch(syncStateWithFirestore());

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['alpha', 'bravo']);
    expect(shown(store).selected).toBe(null);
    expect(shown(store).flagged).toEqual([]);
  });

  it("(c) the page's own first edit: a later sync keeps alpha, not bravo", async () => {
    const { store } = signedInStore();
    // This page saves its first two sessions (each save selects the saved
    // one), then selects alpha.
    store.dispatch(saveToTabContainerInternal(session('bravo')));
    store.dispatch(saveToTabContainerInternal(session('alpha')));
    store.dispatch(selectTabContainer('alpha'));
    expect(shown(store).selected).toBe('alpha');

    otherPageOpensAndSelects('bravo');
    // Same data, so the storage event takes nothing in.
    store.dispatch(hydrateSessionsFromStorage());

    await store.dispatch(syncStateWithFirestore());

    expect(mocks.saveToFirestore).toHaveBeenCalled();
    expect(shown(store).selected).toBe('alpha');
    expect(shown(store).flagged).toEqual(['alpha']);
  });
});
