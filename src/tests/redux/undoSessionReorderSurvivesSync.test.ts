import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  moveSessionInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';

// KAN-130, and the check this module has earned four times over.
//
// reconcileAssertedContainer only stamps a restored session it can SEE has
// changed, and it decides that with sameSessionContent. Any field the
// comparator does not read is a field whose undo is silently reverted by the
// next sync: the session is handed back carrying its snapshot timestamp and
// loses the merge to the cloud copy that still holds the edit.
//
// `rank` is a new field, so it is a new hole until the comparator reads it.
// KAN-80, KAN-83 and KAN-125 were all exactly this, and KAN-129 was where I
// credited the WRONG field and the mutation disproved it -- so this is verified
// by blinding the comparator, not by reading it.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const session = (id: string, createdAt: number) => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-09-09 12:00:00',
  createdAt,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window',
      tabs: [
        { tabId: `${id}-t`, favicon: '', title: 'Tab', url: 'https://a.co' },
      ],
    },
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];
const ids = (s: Store) =>
  s.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

const seeded = () => {
  const { store } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  store.dispatch(saveToTabContainerInternal(session('a', T0 - 2 * HOUR)));
  store.dispatch(saveToTabContainerInternal(session('b', T0 - HOUR)));
  store.dispatch(saveToTabContainerInternal(session('c', T0)));
  return store;
};

describe('undoing a session reorder survives the next sync (KAN-130)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the order the user undid', async () => {
    const store = seeded();
    expect(ids(store)).toEqual(['c', 'b', 'a']);

    store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));
    expect(ids(store)).toEqual(['a', 'c', 'b']);

    // The cloud received the reorder, exactly as auto-sync would have pushed
    // it, before the undo.
    const cloud = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    // The undo itself works -- asserted separately, because this and the merge
    // failing look identical from the UI and are not the same bug.
    expect(afterUndo.tabGroups.map((g) => g.tabGroupId)).toEqual([
      'c',
      'b',
      'a',
    ]);

    mocks.loadFromFirestore.mockResolvedValue(cloud);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(ids(store)).toEqual(['c', 'b', 'a']);
    // And the rank is gone, not merely out-ranked -- otherwise the list is
    // chronological by luck and the next edit reveals the stale rank.
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'a')!.rank
    ).toBeUndefined();
  });

  // THE CONTROL, and the one that says the comparator is scoped correctly.
  // Reporting MORE sessions as changed makes the assertion above easier to
  // pass, and turns an undo into an assertion over the whole container --
  // overwriting edits another device made to sessions the user never touched.
  it('does not clobber an unrelated session edited elsewhere', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const store = seeded();

      vi.setSystemTime(T0 + 1_000);
      store.dispatch(moveSessionInternal({ tabGroupId: 'a', toIndex: 0 }));

      const cloud = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const b = cloud.tabGroups.find(
        (g: { tabGroupId: string }) => g.tabGroupId === 'b'
      );
      b.title = 'EDITED ON LAPTOP';
      b.lastModified = T0 + 500;

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const afterUndo = store.getState().tabContainerDataState;

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState;
      expect(merged.tabGroups.map((g) => g.tabGroupId)).toEqual([
        'c',
        'b',
        'a',
      ]);
      expect(merged.tabGroups.find((g) => g.tabGroupId === 'b')!.title).toBe(
        'EDITED ON LAPTOP'
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
