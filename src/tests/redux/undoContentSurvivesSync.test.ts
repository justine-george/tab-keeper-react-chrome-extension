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
  updateTabGroupTitle,
  updateWindowGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string, title: string): tabContainerData {
  return {
    tabGroupId: id,
    title,
    createdTime: '2026-08-31 00:00:00',
    createdAt: Date.UTC(2026, 7, 31, 0, 0, 0),
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 'window',
        tabs: [
          {
            tabId: `t-${id}`,
            favicon: '',
            title: 'Kagi',
            url: 'https://kagi.com/',
          },
        ],
      },
    ],
  };
}

const titleOf = (id: string, groups: tabContainerData[]) =>
  groups.find((g) => g.tabGroupId === id)?.title;

// KAN-55, the content half of the defect undoTombstone.test.ts covers for
// deletes.
//
// The merge resolves each session by its own `lastModified`, cloud winning ties
// (collect() in mergeTabData.ts uses `at >= existing.at` with cloud collected
// second). restoreContainer stamps a fresh timestamp ONLY on a session it is
// withdrawing from a tombstone; every other session is handed back with the
// timestamp it was snapshotted with.
//
// So undoing a rename hands the merge a session that is OLDER than the renamed
// copy already in the cloud. The cloud wins and the rename comes back: the undo
// applies locally, then sync silently reverses it. Verified against the real
// extension -- online the title never reverts, offline it does.
describe('undoing a content edit survives the next sync (KAN-55)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps a session title the user undid', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('s1', 'Alpha')));

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 's1', editableTitle: 'RENAMED' })
    );
    // The cloud received the rename, exactly as auto-sync would have pushed it.
    const cloudAfterRename = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(titleOf('s1', cloudAfterRename.tabGroups)).toBe('RENAMED');

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    // The undo itself works -- this is not where the defect is.
    expect(titleOf('s1', afterUndo.tabGroups)).toBe('Alpha');

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterRename);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(
      titleOf('s1', store.getState().tabContainerDataState.tabGroups)
    ).toBe('Alpha');
  });

  // Same defect one level down: a window rename lives inside the session, so it
  // rides on the same per-session timestamp and loses the same way.
  it('keeps a window title the user undid', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('s1', 'Alpha')));

    store.dispatch(
      updateWindowGroupTitle({
        tabGroupId: 's1',
        windowId: 'w-s1',
        editableTitle: 'RENAMED WINDOW',
      })
    );
    const cloudAfterRename = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    expect(afterUndo.tabGroups[0].windows[0].title).toBe('window');

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterRename);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows[0].title
    ).toBe('window');
  });

  // The control, and the one that decides whether the fix is scoped correctly:
  // an undo must assert only the sessions it changes. If it stamps every
  // session it is carrying, it silently outranks edits another device made to
  // sessions the user never touched here -- turning an undo of a rename into
  // data loss somewhere else.
  //
  // Time is pinned so the ordering is a property of the fix and not of how
  // fast the test happens to run. An earlier version of this control gave the
  // laptop's edit a timestamp 60s in the FUTURE, which beat any local stamp --
  // so it passed even when the fix bumped every session. A mutation that
  // widened the fix to `current !== undefined` survived it. The margins below
  // exist to make that mutation fail.
  it('does not clobber an unrelated session edited elsewhere', async () => {
    const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);

      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));

      store.dispatch(saveToTabContainerInternal(group('s1', 'Alpha')));
      store.dispatch(saveToTabContainerInternal(group('s2', 'Bravo')));

      vi.setSystemTime(T0 + 1_000);
      store.dispatch(
        updateTabGroupTitle({ tabGroupId: 's1', editableTitle: 'RENAMED' })
      );

      // The laptop edited s2 half a second after the save -- newer than this
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

      const merged = store.getState().tabContainerDataState.tabGroups;
      // The undo this device performed survives.
      expect(titleOf('s1', merged)).toBe('Alpha');
      // The edit the other device made does too. A fix that stamps every
      // restored session would stamp s2 at T0+2000, outranking the laptop's
      // T0+500, and this device's stale "Bravo" would win.
      expect(titleOf('s2', merged)).toBe('EDITED ON LAPTOP');
    } finally {
      vi.useRealTimers();
    }
  });
});
