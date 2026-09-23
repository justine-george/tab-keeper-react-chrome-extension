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
  moveChromeGroupAcrossWindowsInternal,
  moveChromeGroupInternal,
  moveSessionInternal,
  moveTabAcrossWindowsInternal,
  moveWindowInternal,
  replaceState,
  type TabMasterContainer,
  type tabContainerData,
  type tabData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { chromeTabGroupData } from '../../utils/functions/tabGroups';
import { undo } from '../../redux/slices/undoRedoSlice';
import {
  beginDragHold,
  endDragHold,
  whenDragReleases,
} from '../../redux/dragHold';
import { dropOnTop, type DropOnTop } from '../../redux/dropOnTop';
// The SAME builders the four drag handlers call, so a slip in a handler's
// targetIds or rowExists is a slip here.
import {
  groupDrop,
  sessionDrop,
  tabDrop,
  windowDrop,
} from '../../redux/dropSpecs';
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

// ---------------------------------------------------------------------------
// Every kind of drop, through the builder its handler calls.
//
// These pin INDEX SPACES, not the sync: the waiting change is a local
// replaceState queued with whenDragReleases, which is all dropOnTop sees of a
// held merge. Each fixture is built so the re-aimed index and the raw one land
// the row in different places, and so the no-op cases would visibly change
// something if a move were dispatched.
// ---------------------------------------------------------------------------

const tab = (tabId: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test/`,
  ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
});

const group = (groupId: string): chromeTabGroupData => ({
  groupId,
  title: groupId,
  color: 'blue',
});

const win = (
  windowId: string,
  tabs: tabData[],
  chromeTabGroups?: chromeTabGroupData[]
): windowGroupData => ({
  windowId,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: windowId,
  tabs,
  ...(chromeTabGroups === undefined ? {} : { chromeTabGroups }),
});

// One session 's' holding `windows`, not signed in: nothing here syncs.
const localStore = (windows: windowGroupData[]) => {
  vi.setSystemTime(T0);
  const made = makeTestStore();
  made.store.dispatch(
    replaceState(
      buildContainer([
        buildSession({
          tabGroupId: 's',
          windows,
          windowCount: windows.length,
          tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
        }),
      ])
    )
  );
  return made;
};

// Hold, and queue a change this page did not make: a copy of the current
// container, edited by `edit`, applied when the drop flushes the queue.
const holdWithChange = (
  store: Store,
  edit: (next: TabMasterContainer) => void
) => {
  const next = structuredClone(store.getState().tabContainerDataState);
  edit(next);
  beginDragHold();
  whenDragReleases(() => store.dispatch(replaceState(next)));
};

const sessionOf = (c: TabMasterContainer): tabContainerData => {
  const s = c.tabGroups.find((g) => g.tabGroupId === 's');
  if (!s) throw new Error("session 's' is missing");
  return s;
};
const windowOf = (c: TabMasterContainer, windowId: string): windowGroupData => {
  const w = sessionOf(c).windows.find((x) => x.windowId === windowId);
  if (!w) throw new Error(`window ${windowId} is missing`);
  return w;
};
const windowIds = (store: Store) =>
  sessionOf(store.getState().tabContainerDataState).windows.map(
    (w) => w.windowId
  );
const tabIds = (store: Store, windowId: string) =>
  windowOf(store.getState().tabContainerDataState, windowId).tabs.map(
    (t) => t.tabId
  );

describe('every kind of drop re-aims through its own builder (KAN-279 D12)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    endDragHold();
    vi.useRealTimers();
  });

  describe('windows (moveWindowInternal: the session windows[])', () => {
    const fourWindows = () =>
      ['w1', 'w2', 'w3', 'w4'].map((id) => win(id, [tab(`${id}-t`)]));

    it('re-aims beside its neighbour after a window arrives above', () => {
      const { store } = localStore(fourWindows());
      holdWithChange(store, (next) => {
        sessionOf(next).windows.unshift(win('w0', [tab('w0-t')]));
      });

      // Aimed just below w1.
      dropAndRelease(store, windowDrop('s', 'w4', 1));

      expect(windowIds(store)).toEqual(['w0', 'w1', 'w4', 'w2', 'w3']);
    });

    it('its session deleted meanwhile: no move', () => {
      const { store, seen } = localStore(fourWindows());
      holdWithChange(store, (next) => {
        next.tabGroups = [];
      });

      dropAndRelease(store, windowDrop('s', 'w4', 1));

      expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
      expect(seen).not.toContain(moveWindowInternal.type);
    });
  });

  describe('tabs in one window (moveTabInternal: that window tabs[])', () => {
    it('re-aims beside its neighbour after a tab arrives above', () => {
      const { store } = localStore([
        win('w1', [tab('t1'), tab('t2'), tab('t3'), tab('t4')]),
      ]);
      holdWithChange(store, (next) => {
        windowOf(next, 'w1').tabs.unshift(tab('t0'));
      });

      dropAndRelease(
        store,
        tabDrop({
          tabGroupId: 's',
          tabId: 't4',
          fromWindowId: 'w1',
          toWindowId: 'w1',
          toIndex: 1,
        })
      );

      expect(tabIds(store, 'w1')).toEqual(['t0', 't1', 't4', 't2', 't3']);
    });
  });

  describe('tabs across windows (moveTabAcrossWindowsInternal: the DESTINATION tabs[])', () => {
    const twoWindows = () => [
      win('w1', [tab('a1'), tab('a2')]),
      win('w2', [tab('b1'), tab('b2', 'G'), tab('b3', 'G')], [group('G')]),
    ];
    // a2 into w2, just below b1.
    const a2IntoW2 = (toChromeGroupId?: string) =>
      tabDrop({
        tabGroupId: 's',
        tabId: 'a2',
        fromWindowId: 'w1',
        toWindowId: 'w2',
        toIndex: 1,
        toChromeGroupId,
      });

    it('re-aims in the destination after a tab arrives there', () => {
      const { store } = localStore(twoWindows());
      holdWithChange(store, (next) => {
        windowOf(next, 'w2').tabs.unshift(tab('b0'));
      });

      dropAndRelease(store, a2IntoW2());

      expect(tabIds(store, 'w2')).toEqual(['b0', 'b1', 'a2', 'b2', 'b3']);
      expect(tabIds(store, 'w1')).toEqual(['a1']);
    });

    it('the tab deleted from its source meanwhile: no move', () => {
      const { store, seen } = localStore(twoWindows());
      holdWithChange(store, (next) => {
        windowOf(next, 'w1').tabs = [tab('a1')];
      });

      dropAndRelease(store, a2IntoW2());

      expect(tabIds(store, 'w2')).toEqual(['b1', 'b2', 'b3']);
      expect(seen).not.toContain(moveTabAcrossWindowsInternal.type);
    });

    it('the Chrome group it was joining is gone from the destination: no move', () => {
      const { store, seen } = localStore(twoWindows());
      // Ungrouped on the other side: the band the drop aimed into no longer
      // exists, so there is nothing to join.
      holdWithChange(store, (next) => {
        const w2 = windowOf(next, 'w2');
        w2.chromeTabGroups = [];
        w2.tabs = [tab('b1'), tab('b2'), tab('b3')];
      });

      dropAndRelease(store, a2IntoW2('G'));

      expect(tabIds(store, 'w1')).toEqual(['a1', 'a2']);
      expect(tabIds(store, 'w2')).toEqual(['b1', 'b2', 'b3']);
      expect(seen).not.toContain(moveTabAcrossWindowsInternal.type);
    });
  });

  // A group moves among a window's ITEMS (loose tabs, and each group as one),
  // so the arriving change here is a two-tab GROUP: one item, but two tabs. An
  // index re-aimed in tab ids instead of item ids lands one slot off.
  describe('groups in one window (moveChromeGroupInternal: that window items)', () => {
    const oneWindow = () => [
      win(
        'w1',
        [tab('t1'), tab('t2'), tab('t3'), tab('y1', 'B')],
        [group('B')]
      ),
    ];

    it('re-aims by item id after a group arrives above', () => {
      const { store } = localStore(oneWindow());
      holdWithChange(store, (next) => {
        const w1 = windowOf(next, 'w1');
        w1.tabs.unshift(tab('n1', 'N'), tab('n2', 'N'));
        w1.chromeTabGroups = [...(w1.chromeTabGroups ?? []), group('N')];
      });

      // B, aimed just below t1.
      dropAndRelease(
        store,
        groupDrop({
          tabGroupId: 's',
          groupId: 'B',
          fromWindowId: 'w1',
          toWindowId: 'w1',
          toIndex: 1,
        })
      );

      expect(tabIds(store, 'w1')).toEqual(['n1', 'n2', 't1', 'y1', 't2', 't3']);
    });

    it('the group gone from its window meanwhile: no move', () => {
      const { store, seen } = localStore(oneWindow());
      holdWithChange(store, (next) => {
        const w1 = windowOf(next, 'w1');
        w1.chromeTabGroups = [];
        w1.tabs = [tab('t1'), tab('t2'), tab('t3'), tab('y1')];
      });

      dropAndRelease(
        store,
        groupDrop({
          tabGroupId: 's',
          groupId: 'B',
          fromWindowId: 'w1',
          toWindowId: 'w1',
          toIndex: 1,
        })
      );

      expect(tabIds(store, 'w1')).toEqual(['t1', 't2', 't3', 'y1']);
      expect(seen).not.toContain(moveChromeGroupInternal.type);
    });
  });

  describe('groups across windows (moveChromeGroupAcrossWindowsInternal: the DESTINATION items)', () => {
    const twoWindows = () => [
      win('w1', [tab('x1', 'A'), tab('x2', 'A'), tab('t1')], [group('A')]),
      win('w2', [tab('u1'), tab('u2'), tab('u3')]),
    ];
    // A into w2, just below u1.
    const aIntoW2 = () =>
      groupDrop({
        tabGroupId: 's',
        groupId: 'A',
        fromWindowId: 'w1',
        toWindowId: 'w2',
        toIndex: 1,
      });

    it('re-aims by item id in the destination after a group arrives there', () => {
      const { store } = localStore(twoWindows());
      holdWithChange(store, (next) => {
        const w2 = windowOf(next, 'w2');
        w2.tabs.unshift(tab('n1', 'N'), tab('n2', 'N'));
        w2.chromeTabGroups = [group('N')];
      });

      dropAndRelease(store, aIntoW2());

      expect(tabIds(store, 'w2')).toEqual([
        'n1',
        'n2',
        'u1',
        'x1',
        'x2',
        'u2',
        'u3',
      ]);
      expect(tabIds(store, 'w1')).toEqual(['t1']);
    });

    it('the group gone from its source meanwhile: no move', () => {
      const { store, seen } = localStore(twoWindows());
      holdWithChange(store, (next) => {
        const w1 = windowOf(next, 'w1');
        w1.chromeTabGroups = [];
        w1.tabs = [tab('x1'), tab('x2'), tab('t1')];
      });

      dropAndRelease(store, aIntoW2());

      expect(tabIds(store, 'w2')).toEqual(['u1', 'u2', 'u3']);
      expect(seen).not.toContain(moveChromeGroupAcrossWindowsInternal.type);
    });
  });
});
