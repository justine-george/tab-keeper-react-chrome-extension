import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// A cloud that holds what was last written to it, for the KAN-83 tail's sync.
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
  applyOtherPageSessions,
  applyOtherPageSettings,
} from '../../redux/otherPageChanges';
import {
  hydrateFromOtherPage,
  replaceState,
  selectTabContainer,
  updateTabGroupTitle,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  grantCloudConsent,
  hydrateSettingsFromOtherPage,
  Language,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import {
  setFirebaseAuthed,
  setHasSyncedBefore,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { dropOnTop } from '../../redux/dropOnTop';
import { sessionDrop } from '../../redux/dropSpecs';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// KAN-279 D9. Another page wrote tabContainerData or settingsData. This page
// takes the slice in only when the DATA changed, keeps its own selection,
// resets its undo (D12), never writes back, and waits while a row is held.

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const MIN = 60_000;

type Store = ReturnType<typeof makeTestStore>['store'];

// Explicit lastModified: the real stored shape, what every merge writes.
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

// What another page does: write the key, bypassing this page's store. The
// storage event that tells this page is Task 10's; here the thunk is called
// directly, as the hook will.
const otherPageWrites = (key: string, value: unknown) =>
  localStorage.setItem(key, JSON.stringify(value));

function readLocalStorageContainer(): TabMasterContainer {
  const data = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(data)) {
    throw new Error(
      'tabContainerData in localStorage is not a valid TabMasterContainer'
    );
  }
  return data;
}

// Every action type except thunks: "no dispatch" means none of these.
const actionTypes = (seen: string[]) => seen.filter((t) => t !== 'THUNK');

const ids = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

const selectedIds = (c: TabMasterContainer) =>
  c.tabGroups.filter((g) => g.isSelected).map((g) => g.tabGroupId);

// `seed` in the store (replaceState writes the store AND localStorage), 'a'
// selected, then one captured edit so `past` holds something a reset would
// visibly clear.
const storeWithHistory = (seed: TabMasterContainer) => {
  vi.setSystemTime(T0);
  const made = makeTestStore();
  made.store.dispatch(replaceState(seed));
  made.store.dispatch(selectTabContainer('a'));
  made.store.dispatch(
    updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'a (edited here)' })
  );
  expect(made.store.getState().undoRedo.past.length).toBeGreaterThan(0);
  made.seen.length = 0;
  return made;
};

describe('applyOtherPageSessions (KAN-279 D9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    endDragHold();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // (1) Addition C: the realistic stored shape is the output of a prior merge
  // (two devices, tombstones on each side), not a hand-built container. Then
  // the other page runs a sync that learns nothing, and writes the result.
  it('(1) the bytes a no-change merge writes: no dispatch, past intact (real stored shape)', () => {
    const priorMerge = mergeTabContainers(
      {
        ...buildContainer([session('a', T0 - 10 * MIN)]),
        deletedTabGroups: [{ tabGroupId: 'gone-here', deletedAt: T0 - MIN }],
      },
      {
        ...buildContainer([session('b', T0 - 20 * MIN)]),
        deletedTabGroups: [
          { tabGroupId: 'gone-there', deletedAt: T0 - 2 * MIN },
        ],
      },
      T0
    ).merged;
    // Premise: the prior merge really did produce the realistic shape --
    // both sides' sessions and both sides' tombstones.
    expect(priorMerge.tabGroups.map((g) => g.tabGroupId).sort()).toEqual([
      'a',
      'b',
    ]);
    expect(priorMerge.deletedTabGroups?.length).toBe(2);

    const { store, seen } = storeWithHistory(priorMerge);
    const x = store.getState().tabContainerDataState;
    const pastBefore = store.getState().undoRedo.past;
    seen.length = 0;

    otherPageWrites(
      'tabContainerData',
      mergeTabContainers(x, structuredClone(x), T0 + MIN).merged
    );
    store.dispatch(applyOtherPageSessions());

    expect(actionTypes(seen)).toEqual([]);
    expect(store.getState().undoRedo.past).toBe(pastBefore);
  });

  // (1b) The same, with legacy sessions that carry no lastModified: the
  // no-change merge stamps them, so the bytes differ while the data does not.
  it('(1b) a no-change merge over legacy sessions (no lastModified): no dispatch', () => {
    vi.setSystemTime(T0);
    const { store, seen } = makeTestStore();
    store.dispatch(
      replaceState(
        buildContainer([
          buildSession({ tabGroupId: 'a', title: 'a' }),
          buildSession({ tabGroupId: 'b', title: 'b' }),
        ])
      )
    );
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'A' })
    );
    const x = store.getState().tabContainerDataState;
    // Premise: b is legacy, so the merge below really does change the bytes.
    expect(x.tabGroups.find((g) => g.tabGroupId === 'b')?.lastModified).toBe(
      undefined
    );
    const written = mergeTabContainers(x, structuredClone(x), T0 + MIN).merged;
    expect(JSON.stringify(written)).not.toBe(JSON.stringify(x));
    const pastBefore = store.getState().undoRedo.past;
    seen.length = 0;

    otherPageWrites('tabContainerData', written);
    store.dispatch(applyOtherPageSessions());

    expect(actionTypes(seen)).toEqual([]);
    expect(store.getState().undoRedo.past).toBe(pastBefore);
  });

  // (2) The other page selected another session. Selection is per-page view
  // state; the bytes differ, the data does not.
  it('(2) a selection-only difference: no dispatch', () => {
    const { store, seen } = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN), session('b', T0 - 20 * MIN)])
    );
    const mine = store.getState().tabContainerDataState;
    const pastBefore = store.getState().undoRedo.past;

    otherPageWrites('tabContainerData', {
      ...mine,
      selectedTabGroupId: 'b',
      tabGroups: mine.tabGroups.map((g) => ({
        ...g,
        isSelected: g.tabGroupId === 'b',
      })),
    });
    store.dispatch(applyOtherPageSessions());

    expect(actionTypes(seen)).toEqual([]);
    expect(store.getState().tabContainerDataState).toBe(mine);
    expect(store.getState().undoRedo.past).toBe(pastBefore);
  });

  // (3) A real change: taken in, undo reset, this page's selection kept, and
  // nothing written back (a write would echo to the other page forever).
  it('(3) one title changed: hydrated, past empty, own selection kept, nothing written back', () => {
    const { store, seen } = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN), session('b', T0 - 20 * MIN)])
    );
    const mine = store.getState().tabContainerDataState;
    otherPageWrites('tabContainerData', {
      ...mine,
      lastModified: T0 + MIN,
      // The other page had b selected.
      selectedTabGroupId: 'b',
      tabGroups: mine.tabGroups.map((g) =>
        g.tabGroupId === 'b'
          ? {
              ...g,
              title: 'b (renamed elsewhere)',
              lastModified: T0 + MIN,
              isSelected: true,
            }
          : { ...g, isSelected: false }
      ),
    });
    // vitest-localstorage-mock's setItem is already a mock carrying earlier
    // calls, so clear it before counting.
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    setItemSpy.mockClear();

    store.dispatch(applyOtherPageSessions());

    const after = store.getState().tabContainerDataState;
    expect(after.tabGroups.find((g) => g.tabGroupId === 'b')?.title).toBe(
      'b (renamed elsewhere)'
    );
    expect(after.selectedTabGroupId).toBe('a');
    expect(selectedIds(after)).toEqual(['a']);
    expect(store.getState().undoRedo.past).toEqual([]);
    expect(store.getState().undoRedo.future).toEqual([]);
    expect(store.getState().undoRedo.present.tabContainerDataState).toEqual(
      after
    );
    expect(actionTypes(seen)).toEqual([
      hydrateFromOtherPage.type,
      resetHistory.type,
    ]);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  // (4) Not a container: dropped with a warning, nothing dispatched.
  it('(4) an invalid JSON object: no dispatch, console.warn once', () => {
    const { store, seen } = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN)])
    );
    const mine = store.getState().tabContainerDataState;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    otherPageWrites('tabContainerData', { tabGroups: 'not an array' });
    store.dispatch(applyOtherPageSessions());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(actionTypes(seen)).toEqual([]);
    expect(store.getState().tabContainerDataState).toBe(mine);
  });

  // Absent is no value, not an invalid one.
  it('(4b) absent: no dispatch and no warning', () => {
    const { store, seen } = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN)])
    );
    localStorage.removeItem('tabContainerData');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    store.dispatch(applyOtherPageSessions());

    expect(warn).not.toHaveBeenCalled();
    expect(actionTypes(seen)).toEqual([]);
  });

  // (5) The other page deleted the session this page had selected: the same
  // fallback a delete here uses (deleteTabContainerInternal: null).
  it('(5) selected session deleted elsewhere: selectedTabGroupId null, nothing isSelected', () => {
    const { store } = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN), session('b', T0 - 20 * MIN)])
    );
    const mine = store.getState().tabContainerDataState;
    otherPageWrites('tabContainerData', {
      ...mine,
      lastModified: T0 + MIN,
      selectedTabGroupId: null,
      tabGroups: mine.tabGroups
        .filter((g) => g.tabGroupId !== 'a')
        .map((g) => ({ ...g, isSelected: false })),
      deletedTabGroups: [{ tabGroupId: 'a', deletedAt: T0 + MIN }],
    });

    store.dispatch(applyOtherPageSessions());

    const after = store.getState().tabContainerDataState;
    expect(ids(store)).toEqual(['b']);
    expect(after.selectedTabGroupId).toBe(null);
    expect(selectedIds(after)).toEqual([]);
  });

  // (5b) The other page's selection is never adopted, even when this page's
  // session is gone and the other page has one selected.
  it("(5b) selected session deleted elsewhere: the other page's selection is not adopted", () => {
    const { store } = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN), session('b', T0 - 20 * MIN)])
    );
    const mine = store.getState().tabContainerDataState;
    otherPageWrites('tabContainerData', {
      ...mine,
      lastModified: T0 + MIN,
      selectedTabGroupId: 'b',
      tabGroups: mine.tabGroups
        .filter((g) => g.tabGroupId !== 'a')
        .map((g) => ({ ...g, isSelected: true })),
      deletedTabGroups: [{ tabGroupId: 'a', deletedAt: T0 + MIN }],
    });

    store.dispatch(applyOtherPageSessions());

    const after = store.getState().tabContainerDataState;
    expect(after.selectedTabGroupId).toBe(null);
    expect(selectedIds(after)).toEqual([]);
  });

  // (6) A held row: the change waits for the release, then lands.
  it(
    '(6) held drag: not applied until endDragHold(), then it is',
    { timeout: 5000 },
    () => {
      const { store, seen } = storeWithHistory(
        buildContainer([
          session('a', T0 - 10 * MIN),
          session('b', T0 - 20 * MIN),
        ])
      );
      const mine = store.getState().tabContainerDataState;
      beginDragHold();
      otherPageWrites('tabContainerData', {
        ...mine,
        lastModified: T0 + MIN,
        tabGroups: [session('n', T0 - 5 * MIN), ...mine.tabGroups],
      });

      store.dispatch(applyOtherPageSessions());

      expect(actionTypes(seen)).toEqual([]);
      expect(store.getState().tabContainerDataState).toBe(mine);

      endDragHold();

      expect(ids(store)).toEqual(['n', 'a', 'b']);
      expect(store.getState().undoRedo.past).toEqual([]);
    }
  );

  // (6c) The queued apply reads localStorage when it RUNS: a second write
  // while held, with no second dispatch, is the one that lands.
  it('(6c) held drag: a later write lands, not the one that queued the apply', () => {
    const { store } = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN), session('b', T0 - 20 * MIN)])
    );
    const mine = store.getState().tabContainerDataState;
    beginDragHold();
    otherPageWrites('tabContainerData', {
      ...mine,
      lastModified: T0 + MIN,
      tabGroups: [session('v1', T0 - 5 * MIN), ...mine.tabGroups],
    });
    store.dispatch(applyOtherPageSessions());
    otherPageWrites('tabContainerData', {
      ...mine,
      lastModified: T0 + 2 * MIN,
      tabGroups: [
        session('v2', T0 - 4 * MIN),
        session('v1', T0 - 5 * MIN),
        ...mine.tabGroups,
      ],
    });

    endDragHold();

    expect(ids(store)).toEqual(['v2', 'v1', 'a', 'b']);
  });

  // (6b) The drop path: dropOnTop flushes the queue with the flag STILL set,
  // so the queued apply must not re-check the hold -- it would re-queue
  // itself, the drop would land in the old list, and its write would put the
  // other page's change out of localStorage for good.
  it(
    '(6b) held drag: at the drop the change lands first and the drop goes on top',
    { timeout: 5000 },
    () => {
      const { store } = storeWithHistory(
        buildContainer([
          session('a', T0 - 10 * MIN),
          session('b', T0 - 20 * MIN),
          session('c', T0 - 30 * MIN),
          session('d', T0 - 40 * MIN),
        ])
      );
      const mine = store.getState().tabContainerDataState;
      beginDragHold();
      otherPageWrites('tabContainerData', {
        ...mine,
        lastModified: T0 + MIN,
        tabGroups: [session('n', T0 - 5 * MIN), ...mine.tabGroups],
      });
      store.dispatch(applyOtherPageSessions());
      expect(ids(store)).toEqual(['a', 'b', 'c', 'd']);

      // d aimed between a and b; RowDragArea.finish then ends the hold.
      store.dispatch(dropOnTop(sessionDrop('d', 1)));
      endDragHold();

      expect(ids(store)).toEqual(['n', 'a', 'd', 'b', 'c']);
      expect(
        readLocalStorageContainer().tabGroups.map((g) => g.tabGroupId)
      ).toEqual(['n', 'a', 'd', 'b', 'c']);
      // The drop is the one undo step on top of the reset.
      expect(store.getState().undoRedo.past.length).toBe(1);
    }
  );
});

describe('applyOtherPageSettings (KAN-279 D9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const settingsStore = () => {
    const made = storeWithHistory(
      buildContainer([session('a', T0 - 10 * MIN)])
    );
    return made;
  };

  const otherThan = (l: Language) =>
    l === Language.DE ? Language.FR : Language.DE;

  it('(7a) only lastSyncedTime changed: hydrated, languageChanged null, tab-container undo untouched', () => {
    const { store, seen } = settingsStore();
    const current: SettingsData = store.getState().settingsDataState;
    const undoBefore = store.getState().undoRedo;
    const setItemSpy = vi.spyOn(localStorage, 'setItem');

    otherPageWrites('settingsData', { ...current, lastSyncedTime: T0 + MIN });
    setItemSpy.mockClear();
    const result = store.dispatch(applyOtherPageSettings());

    expect(result).toEqual({ languageChanged: null });
    expect(store.getState().settingsDataState.lastSyncedTime).toBe(T0 + MIN);
    expect(store.getState().undoRedo).toBe(undoBefore);
    expect(actionTypes(seen)).toEqual([hydrateSettingsFromOtherPage.type]);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('(7b) language changed: languageChanged is the new language', () => {
    const { store } = settingsStore();
    const current = store.getState().settingsDataState;
    const next = otherThan(current.language);

    otherPageWrites('settingsData', { ...current, language: next });
    const result = store.dispatch(applyOtherPageSettings());

    expect(result).toEqual({ languageChanged: next });
    expect(store.getState().settingsDataState.language).toBe(next);
  });

  it('(7c) nothing changed (keys in another order): no dispatch', () => {
    const { store, seen } = settingsStore();
    const current = store.getState().settingsDataState;
    const reversed = Object.fromEntries(Object.entries(current).reverse());

    otherPageWrites('settingsData', reversed);
    const result = store.dispatch(applyOtherPageSettings());

    expect(result).toEqual({ languageChanged: null });
    expect(actionTypes(seen)).toEqual([]);
    expect(store.getState().settingsDataState).toBe(current);
  });

  it('(7d) a non-object value: no dispatch, console.warn once', () => {
    const { store, seen } = settingsStore();
    const current = store.getState().settingsDataState;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    otherPageWrites('settingsData', ['not', 'settings']);
    const result = store.dispatch(applyOtherPageSettings());

    expect(result).toEqual({ languageChanged: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(actionTypes(seen)).toEqual([]);
    expect(store.getState().settingsDataState).toBe(current);
  });

  // An unshipped language would make i18next fetch a locale file that does
  // not exist (#42). It keeps this page's language instead.
  it('(7e) an unshipped language: languageChanged null, language unchanged', () => {
    const { store, seen } = settingsStore();
    const current = store.getState().settingsDataState;

    otherPageWrites('settingsData', { ...current, language: 'xx' });
    const result = store.dispatch(applyOtherPageSettings());

    expect(result).toEqual({ languageChanged: null });
    expect(store.getState().settingsDataState.language).toBe(current.language);
    expect(actionTypes(seen)).toEqual([]);
  });

  // The rest of the write still lands; only the language is withheld.
  it('(7f) an unshipped language beside a real change: the change lands, the language does not', () => {
    const { store } = settingsStore();
    const current = store.getState().settingsDataState;

    otherPageWrites('settingsData', {
      ...current,
      language: 'xx',
      lastSyncedTime: T0 + MIN,
    });
    const result = store.dispatch(applyOtherPageSettings());

    expect(result).toEqual({ languageChanged: null });
    expect(store.getState().settingsDataState.lastSyncedTime).toBe(T0 + MIN);
    expect(store.getState().settingsDataState.language).toBe(current.language);
  });

  it('(7g) absent: no dispatch and no warning', () => {
    const { store, seen } = settingsStore();
    localStorage.removeItem('settingsData');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = store.dispatch(applyOtherPageSettings());

    expect(result).toEqual({ languageChanged: null });
    expect(warn).not.toHaveBeenCalled();
    expect(actionTypes(seen)).toEqual([]);
  });
});

// Addition B. The KAN-83 tail, now that D9 exists: a session another page
// brought in survives the next sync, and a later undo neither buries nor
// drops it. Two-sided: the cloud holds `theirs` plus a session from device B
// that this page lacks, and LACKS this page's rename -- so the sync genuinely
// merges in both directions rather than echoing local back.
describe('KAN-83 tail: a session another page brought in survives sync and undo', () => {
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

  it('hydrate, sync against a cloud holding it, then undo: theirs stays and is not buried', async () => {
    vi.setSystemTime(T0);
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(setSignedIn());
    store.dispatch(setFirebaseAuthed());
    store.dispatch(grantCloudConsent());
    store.dispatch(
      replaceState(
        buildContainer([
          session('mine-1', T0 - 10 * MIN),
          session('mine-2', T0 - 20 * MIN),
        ])
      )
    );
    store.dispatch(setHasSyncedBefore());
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'mine-2', editableTitle: 'mine-2 v2' })
    );

    // 1. Another page (which got `theirs` from the other device) writes it.
    vi.setSystemTime(T0 + MIN);
    const mine = readLocalStorageContainer();
    const withTheirs: TabMasterContainer = {
      ...mine,
      lastModified: T0 + MIN,
      tabGroups: [
        session('theirs', T0 - 5 * MIN, { lastModified: T0 + MIN }),
        ...mine.tabGroups,
      ],
    };
    otherPageWrites('tabContainerData', withTheirs);

    // 2. This page takes it in.
    store.dispatch(applyOtherPageSessions());
    expect([...ids(store)].sort()).toEqual(['mine-1', 'mine-2', 'theirs']);

    // This page's own edit after the hydrate: the cloud below lacks it.
    vi.setSystemTime(T0 + 2 * MIN);
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'mine-1', editableTitle: 'renamed' })
    );

    // The cloud: two-sided. It holds `theirs` and a session device B saved
    // that this page lacks, and it lacks this page's rename.
    mocks.cloud.doc = structuredClone({
      ...withTheirs,
      lastModified: T0 + MIN,
      tabGroups: [
        session('from-b', T0 - 2 * MIN, { lastModified: T0 + MIN }),
        ...withTheirs.tabGroups,
      ],
    });

    // 3. A later sync keeps `theirs`, brings `from-b` in, and uploads the
    // rename: a real merge, not an echo.
    vi.setSystemTime(T0 + 3 * MIN);
    await store.dispatch(syncStateWithFirestore());
    await vi.runAllTimersAsync();
    expect([...ids(store)].sort()).toEqual([
      'from-b',
      'mine-1',
      'mine-2',
      'theirs',
    ]);
    expect(store.getState().globalState.syncStatus).toBe('success');
    const cloud = mocks.cloud.doc;
    if (!isValidTabMasterContainer(cloud)) {
      throw new Error('the cloud does not hold a valid container');
    }
    expect(cloud.tabGroups.map((g) => g.tabGroupId).sort()).toEqual([
      'from-b',
      'mine-1',
      'mine-2',
      'theirs',
    ]);
    expect(cloud.tabGroups.find((g) => g.tabGroupId === 'mine-1')?.title).toBe(
      'renamed'
    );

    // 4. An edit after the sync, so undo has a step to retract; the undo
    // retracts it and nothing else.
    vi.setSystemTime(T0 + 4 * MIN);
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'mine-2', editableTitle: 'mine-2 v3' })
    );
    expect(store.getState().undoRedo.past.length).toBe(1);
    store.dispatch(undo());

    const after = store.getState().tabContainerDataState;
    expect(after.tabGroups.find((g) => g.tabGroupId === 'mine-2')?.title).toBe(
      'mine-2 v2'
    );
    expect(ids(store)).toContain('theirs');
    expect(ids(store)).toContain('from-b');
    const graves = (after.deletedTabGroups ?? []).map((t) => t.tabGroupId);
    expect(graves).not.toContain('theirs');
    expect(graves).not.toContain('from-b');
  });
});
