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
  moveSessionInternal,
  replaceState,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { dropOnTop, type DropOnTop } from '../../redux/dropOnTop';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// KAN-279 D12. While a row is held, a change this page did not make waits.
// At the drop it is applied FIRST, and the drop goes on top of it, re-aimed
// by neighbour. Every held change here comes from a SECOND device: a cloud
// that holds something this device lacks, never an echo of local.

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const MIN = 60_000;

// No rank, so the list is ordered by createdAt (no contentModified either).
// lastModified is explicit so the merge's per-session winner is decided by
// what each test sets, not by the container's fallback timestamp.
const session = (
  id: string,
  createdAt: number,
  extra: Partial<tabContainerData> = {}
): tabContainerData =>
  buildSession({
    tabGroupId: id,
    title: id,
    createdAt,
    lastModified: createdAt,
    ...extra,
  });

// Signed in, consented, past the first sync, the clock pinned, and `sessions`
// seeded into both the store and localStorage (replaceState writes both).
const readyStore = (sessions: tabContainerData[]) => {
  vi.setSystemTime(T0);
  const made = makeTestStore();
  const { store } = made;
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  store.dispatch(replaceState(buildContainer(sessions)));
  store.dispatch(setHasSyncedBefore());
  return made;
};

// No `!` and no untyped JSON.parse: loadFromLocalStorage returns `unknown`,
// and isValidTabMasterContainer narrows it. Every caller has just written the
// container, so an invalid read means the fixture is broken.
function readLocalStorageContainer(): TabMasterContainer {
  const data = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(data)) {
    throw new Error(
      'tabContainerData in localStorage is not a valid TabMasterContainer'
    );
  }
  return data;
}

// The other device's copy: what this device holds, as the cloud last saw it,
// then changed there.
const cloudFrom = (
  change: (local: TabMasterContainer) => TabMasterContainer
): TabMasterContainer => change(structuredClone(readLocalStorageContainer()));

// The session handler's drop, as TabGroupEntryContainer.handleMoveSession
// builds it.
const sessionDrop = (tabGroupId: string, toIndex: number): DropOnTop => ({
  rowId: tabGroupId,
  toIndex,
  targetIds: (s) => s.tabGroups.map((g) => g.tabGroupId),
  rowExists: (s) => s.tabGroups.some((g) => g.tabGroupId === tabGroupId),
  move: (i) => moveSessionInternal({ tabGroupId, toIndex: i }),
});

type Store = ReturnType<typeof makeTestStore>['store'];
const ids = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

// The order RowDragArea.finish runs them in: the consumer's onMove (which
// dispatches dropOnTop), then endDragHold as finish's last statement.
const dropAndRelease = (store: Store, drop: DropOnTop) => {
  store.dispatch(dropOnTop(drop));
  endDragHold();
};

// a, b, c, d, newest first by createdAt.
const abcd = () => [
  session('a', T0 - 10 * MIN),
  session('b', T0 - 20 * MIN),
  session('c', T0 - 30 * MIN),
  session('d', T0 - 40 * MIN),
];

// Hold, then run a sync whose merge changes local data: it is queued, not
// applied. The premise check makes the held state explicit, so a test below
// cannot pass because the change had already landed before the drop.
const holdAndSync = async (store: Store) => {
  const before = ids(store);
  beginDragHold();
  await store.dispatch(syncStateWithFirestore());
  expect(ids(store)).toEqual(before);
};

describe('dropOnTop: a drop acts on top of a change that arrived while held (KAN-279 D12)', () => {
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

  // (a) The other device saved `n`, which sorts to the top. `d` was aimed
  // between a and b; the old index 1 in the new list would put it above a.
  it('(a) inserted above: the drop stays beside the neighbour it was aimed at', async () => {
    const { store } = readyStore(abcd());
    mocks.cloud.doc = cloudFrom((c) => ({
      ...c,
      tabGroups: [session('n', T0 - 5 * MIN), ...c.tabGroups],
    }));
    await holdAndSync(store);

    dropAndRelease(store, sessionDrop('d', 1));

    expect(ids(store)).toEqual(['n', 'a', 'd', 'b', 'c']);
    await vi.runAllTimersAsync();
    // And it survives the re-sync the held merge starts after the drop.
    expect(ids(store)).toEqual(['n', 'a', 'd', 'b', 'c']);
    expect(
      readLocalStorageContainer().tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['n', 'a', 'd', 'b', 'c']);
  });

  // (b) a and b share createdAt and have no rank, so a drop between them has
  // no rank room: rankBetween returns null and renormalise touches EVERY
  // session. Applied first, the rename is in the list that gets touched;
  // applied after, the touched copy of c outranks the rename and loses it.
  it('(b) a rename made elsewhere survives a drop that renormalises', async () => {
    const { store } = readyStore([
      session('a', T0 - 10 * MIN),
      session('b', T0 - 10 * MIN),
      session('c', T0 - 30 * MIN),
    ]);
    expect(ids(store)).toEqual(['a', 'b', 'c']);
    mocks.cloud.doc = cloudFrom((c) => ({
      ...c,
      tabGroups: c.tabGroups.map((g) =>
        g.tabGroupId === 'c'
          ? { ...g, title: 'Renamed on laptop', lastModified: T0 - MIN }
          : g
      ),
    }));
    await holdAndSync(store);

    // Between a and b.
    dropAndRelease(store, sessionDrop('c', 1));

    const title = (container: TabMasterContainer) =>
      container.tabGroups.find((g) => g.tabGroupId === 'c')?.title;
    expect(ids(store)).toEqual(['a', 'c', 'b']);
    expect(title(store.getState().tabContainerDataState)).toBe(
      'Renamed on laptop'
    );
    expect(title(readLocalStorageContainer())).toBe('Renamed on laptop');
    // The premise: this drop really did renormalise, so every session was
    // touched at the drop instant. Without it the test could pass on a drop
    // that took a midpoint rank and touched only c.
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((g) => g.lastModified)
    ).toEqual([T0, T0, T0]);

    // And the re-sync the held merge starts after the drop keeps it.
    await vi.runAllTimersAsync();
    expect(title(store.getState().tabContainerDataState)).toBe(
      'Renamed on laptop'
    );
  });

  // (c) The other device deleted `d` after this device last changed it. The
  // deletion stands: the drop is dropped, not replayed onto a missing row.
  it('(c) the held row was deleted elsewhere: it stays deleted and no move is dispatched', async () => {
    const { store, seen } = readyStore(abcd());
    mocks.cloud.doc = cloudFrom((c) => ({
      ...c,
      tabGroups: c.tabGroups.filter((g) => g.tabGroupId !== 'd'),
      deletedTabGroups: [{ tabGroupId: 'd', deletedAt: T0 - MIN }],
    }));
    await holdAndSync(store);
    expect(ids(store)).toContain('d');

    dropAndRelease(store, sessionDrop('d', 1));

    expect(ids(store)).toEqual(['a', 'b', 'c']);
    expect(seen).not.toContain(moveSessionInternal.type);
  });

  // (d) The incoming change reset history (a change this page did not make
  // is not undoable), so undo takes back the drop and only the drop.
  it('(d) undo after the drop gives the incoming list without the move', async () => {
    const { store } = readyStore(abcd());
    mocks.cloud.doc = cloudFrom((c) => ({
      ...c,
      tabGroups: [session('n', T0 - 5 * MIN), ...c.tabGroups],
    }));
    await holdAndSync(store);
    dropAndRelease(store, sessionDrop('d', 1));
    expect(ids(store)).toEqual(['n', 'a', 'd', 'b', 'c']);

    store.dispatch(undo());

    expect(ids(store)).toEqual(['n', 'a', 'b', 'c', 'd']);
  });

  // CONTROL: nothing held, nothing queued. dropOnTop is the old handler: it
  // dispatches exactly moveSessionInternal({ tabGroupId, toIndex }) with the
  // index it was given, and the list moves as it always did.
  it('CONTROL: with no held change it dispatches exactly the old move', () => {
    const { store, actions } = readyStore(abcd());

    store.dispatch(dropOnTop(sessionDrop('d', 1)));

    const moves = actions.filter((a) => a.type === moveSessionInternal.type);
    expect(moves).toEqual([
      moveSessionInternal({ tabGroupId: 'd', toIndex: 1 }),
    ]);
    expect(ids(store)).toEqual(['a', 'd', 'b', 'c']);
  });
});
