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
import {
  saveToTabContainerInternal,
  moveWindowInternal,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-129, and the check the ticket asks for by name rather than by assumption.
//
// This module has three reversal regressions behind it (KAN-80, KAN-83,
// KAN-125), all the same shape: reconcileAssertedContainer only stamps a
// restored session it can SEE has changed, and it decides that with
// sameSessionContent. Any field that comparator does not read is a field whose
// undo is silently reverted by the next sync -- the session is handed back
// carrying its snapshot timestamp and loses the merge to the cloud copy that
// still holds the edit.
//
// Window ORDER is visible to it, and the mechanism is worth stating precisely
// because the obvious answer is wrong. It is NOT sameWindowContent's
// `windowId` check: deleting that comparison leaves every test here passing,
// because two windows in one session can never hold equal `tabs` arrays --
// tabIds are uuids minted per tab -- so the contents alone already distinguish
// any two positions.
//
// What carries the order is that sameSessionContent walks a.windows
// POSITIONALLY (tabContainerDataStateSlice.ts:587). Replace that walk with an
// order-blind one -- match each window to the b-window sharing its id -- and
// the two undo tests below fail, which is what pins the property.

const win = (id: string, title: string) => ({
  windowId: id,
  windowHeight: 100,
  windowWidth: 100,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title,
  tabs: [
    {
      tabId: `${id}-t0`,
      favicon: '',
      title: `${title} tab`,
      url: `https://${id}.test`,
    },
  ],
});

function seed(overrides: Partial<tabContainerData> = {}): tabContainerData {
  return {
    tabGroupId: 's1',
    title: 'Alpha',
    createdTime: '2026-09-07 00:00:00',
    createdAt: Date.UTC(2026, 8, 7, 0, 0, 0),
    windowCount: 3,
    tabCount: 3,
    isAutoSave: false,
    isSelected: false,
    windows: [win('w1', 'First'), win('w2', 'Second'), win('w3', 'Third')],
    ...overrides,
  };
}

const orderOf = (state: { tabGroups: tabContainerData[] }, id = 's1') =>
  state.tabGroups
    .find((g) => g.tabGroupId === id)!
    .windows.map((w) => w.windowId);

describe('undoing a window reorder survives the next sync (KAN-129)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the order the user undid', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(saveToTabContainerInternal(seed()));

    store.dispatch(
      moveWindowInternal({ tabGroupId: 's1', windowId: 'w1', toIndex: 2 })
    );

    // The cloud received that reorder exactly as auto-sync would have pushed
    // it, before the undo.
    const cloud = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(orderOf(cloud)).toEqual(['w2', 'w3', 'w1']);

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    // The undo itself works. Asserted separately from the merge because the
    // two failure modes look identical from the UI and are not the same bug.
    expect(orderOf(afterUndo)).toEqual(['w1', 'w2', 'w3']);

    mocks.loadFromFirestore.mockResolvedValue(cloud);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(orderOf(store.getState().tabContainerDataState)).toEqual([
      'w1',
      'w2',
      'w3',
    ]);
  });

  // THE CONTROL, and the one that decides whether the comparator is scoped
  // correctly. Reporting MORE sessions as changed makes the assertion above
  // easier to pass, and turns an undo into an assertion over the whole
  // container -- overwriting edits another device made to sessions the user
  // never touched here. Same trap the KAN-55 and KAN-125 controls were built
  // for.
  //
  // Time is pinned so the ordering is a property of the code, not of how fast
  // the test happens to run.
  it('does not clobber an unrelated session edited elsewhere', async () => {
    const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);

      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));

      store.dispatch(saveToTabContainerInternal(seed()));
      store.dispatch(
        saveToTabContainerInternal(seed({ tabGroupId: 's2', title: 'Bravo' }))
      );

      vi.setSystemTime(T0 + 1_000);
      store.dispatch(
        moveWindowInternal({ tabGroupId: 's1', windowId: 'w1', toIndex: 2 })
      );

      // The laptop renamed s2 half a second after the save -- newer than this
      // device's copy of s2, so the merge should keep it, but comfortably in
      // the past by the time the undo below runs.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const s2 = cloud.tabGroups.find((g) => g.tabGroupId === 's2')!;
      s2.title = 'EDITED ON LAPTOP';
      s2.lastModified = T0 + 500;

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const afterUndo = store.getState().tabContainerDataState;

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState;
      // The undo this device performed survives.
      expect(orderOf(merged)).toEqual(['w1', 'w2', 'w3']);
      // And so does the rename the other device made. A comparator that
      // reported every session as changed would stamp s2 at T0+2000,
      // outranking the laptop's T0+500, and this device's stale title would
      // win.
      expect(merged.tabGroups.find((g) => g.tabGroupId === 's2')!.title).toBe(
        'EDITED ON LAPTOP'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // The merge is session-granular: it never re-sorts a session's windows, it
  // emits the winning session's windows[] verbatim (mergeTabData.ts:184-188).
  // That property is the entire reason this feature needed no schema change,
  // so it is worth a test of its own rather than only being relied on above.
  it('carries the winning side’s window order through a merge untouched', async () => {
    const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);

      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));
      store.dispatch(saveToTabContainerInternal(seed()));

      // The laptop reordered the same session, later, and this device has no
      // competing edit -- so the laptop wins outright and its order must
      // arrive intact rather than being re-derived from anything.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const s1 = cloud.tabGroups.find((g) => g.tabGroupId === 's1')!;
      s1.windows = [s1.windows[2], s1.windows[0], s1.windows[1]];
      s1.lastModified = T0 + 1_000;

      vi.setSystemTime(T0 + 2_000);
      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      expect(orderOf(store.getState().tabContainerDataState)).toEqual([
        'w3',
        'w1',
        'w2',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A reorder must not send the session to the top of the left pane. The list
  // is ordered by createdInstant, so this is the same claim the reducer's
  // `touch`-not-`stampCreated` choice makes, asserted where it is visible:
  // after a real merge.
  it('does not reorder the session list itself', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    // s2 is created later, so it sorts ahead of s1 (newest first).
    store.dispatch(saveToTabContainerInternal(seed()));
    store.dispatch(
      saveToTabContainerInternal(
        seed({
          tabGroupId: 's2',
          title: 'Bravo',
          createdAt: Date.UTC(2026, 8, 7, 6, 0, 0),
        })
      )
    );

    store.dispatch(
      moveWindowInternal({ tabGroupId: 's1', windowId: 'w1', toIndex: 2 })
    );

    const local = store.getState().tabContainerDataState;
    mocks.loadFromFirestore.mockResolvedValue(
      JSON.parse(JSON.stringify(local))
    );
    localStorage.setItem('tabContainerData', JSON.stringify(local));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['s2', 's1']);
  });
});

// A guard on the title path, which shares the comparator. Included because the
// window list is the thing being changed here, and a comparator "fixed" by
// comparing windows more loosely would pass every test above while breaking
// this one.
describe('the comparator still sees a plain title edit', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps a session title the user undid', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(saveToTabContainerInternal(seed()));

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 's1', editableTitle: 'RENAMED' })
    );
    const cloud = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;

    mocks.loadFromFirestore.mockResolvedValue(cloud);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 's1')!
        .title
    ).toBe('Alpha');
  });
});
