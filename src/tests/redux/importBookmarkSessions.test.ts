import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

// The size is the stub's to give: the test says how big each container is.
vi.mock('../../utils/functions/cloudDocument', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../utils/functions/cloudDocument')
  >()),
  syncBytes: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  importBookmarkSessions,
  importSizeRefusal,
  importedBookmarkKeys,
  selectImportedBookmarks,
  selectImportedSessionIds,
} from '../../redux/bookmarkImport';
import {
  deleteTabContainerInternal,
  saveToTabContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { RootState } from '../../redux/store';
import { redo, undo } from '../../redux/slices/undoRedoSlice';
import { syncBytes } from '../../utils/functions/cloudDocument';
import {
  identityKey,
  sessionsFor,
  type SessionFromBookmarks,
} from '../../utils/functions/bookmarkImport';
import { FIRESTORE_MAX_DOCUMENT_BYTES } from '../../utils/functions/local';
import { BOOKMARKS_IMPORTED_FRAME } from '../../utils/constants/common';

// Bookmarks the record names, made with no dateAdded as the fixtures are.
const marks = (ids: string[]) => ids.map((id) => ({ id, dateAdded: null }));

// KAN-862. An import adds sessions the way a save does, without a save's side effects.

const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);

const session = (id: string, tabCount = 2): tabContainerData => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-11-15 12:00:00',
  createdAt: T0,
  windowCount: 1,
  tabCount,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount,
      title: 'Window',
      tabs: Array.from({ length: tabCount }, (_, i) => ({
        tabId: `${id}-t${i}`,
        favicon: '',
        title: `Tab ${i}`,
        url: `https://${id}.test/${i}`,
      })),
    },
  ],
});

// Each session as if made from a folder of its own id's.
const fromFolders = (sessions: tabContainerData[]): SessionFromBookmarks[] =>
  sessions.map((s) => ({
    bookmarks: marks([`folder-${s.tabGroupId}`]),
    session: s,
  }));

// The bookmark ids the record holds now, sorted.
const recorded = (state: RootState) =>
  selectImportedBookmarks(state)
    .filter((e) => !e.isUndone)
    .flatMap((e) => e.bookmarks.map((b) => b.id))
    .sort();

const idsOf = (state: RootState) =>
  state.tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

beforeEach(() => {
  localStorage.clear();
  vi.mocked(syncBytes).mockReset();
});

describe('importBookmarkSessions', () => {
  // Ids sort the other way round: sessions made in one millisecond tie, and a tie falls to the ids.
  test('the first session ends on top and selected, the rest below it in order', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(
        fromFolders([session('c'), session('b'), session('a')])
      )
    );
    const state = store.getState();
    expect(idsOf(state)).toEqual(['c', 'b', 'a']);
    expect(state.tabContainerDataState.selectedTabGroupId).toBe('c');
    expect(
      state.tabContainerDataState.tabGroups.map((g) => g.isSelected)
    ).toEqual([true, false, false]);
  });

  test('it notes the ids it added, and nothing else', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(fromFolders([session('a'), session('b')]))
    );
    expect(selectImportedSessionIds(store.getState())).toEqual(['a', 'b']);
    store.dispatch(importBookmarkSessions(fromFolders([session('c')])));
    expect(selectImportedSessionIds(store.getState())).toEqual(['a', 'b', 'c']);
  });

  // KAN-862 (11-16). What it came from, so none of it is imported again on this device.
  test('it records the bookmark ids each session covers, with the session, and saves the record', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['l1', 'l3']), session: session('a') },
        { bookmarks: marks(['kitchen']), session: session('b') },
      ])
    );
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['work']), session: session('c') },
      ])
    );
    expect(recorded(store.getState())).toEqual(['kitchen', 'l1', 'l3', 'work']);
    const saved = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
    expect(saved.importedBookmarks).toEqual([
      { sessionId: 'a', bookmarks: marks(['l1', 'l3']), isUndone: false },
      { sessionId: 'b', bookmarks: marks(['kitchen']), isUndone: false },
      { sessionId: 'c', bookmarks: marks(['work']), isUndone: false },
    ]);
  });

  // KAN-862 G. The keys the tree checks: id and dateAdded, and none from an undone import.
  test('importedBookmarkKeys keys each live entry by id and dateAdded', () => {
    expect(
      [
        ...importedBookmarkKeys([
          {
            sessionId: 'a',
            bookmarks: [{ id: '7', dateAdded: 1000 }],
            isUndone: false,
          },
          { sessionId: 'b', bookmarks: marks(['8']), isUndone: false },
          { sessionId: 'c', bookmarks: marks(['9']), isUndone: true },
        ]),
      ].sort()
    ).toEqual(
      [
        identityKey({ id: '7', dateAdded: 1000 }),
        identityKey({ id: '8', dateAdded: null }),
      ].sort()
    );
    expect(identityKey({ id: '7', dateAdded: 1000 })).not.toBe(
      identityKey({ id: '7', dateAdded: 2000 })
    );
  });

  // KAN-862 R21. His permanent rule: a session deleted later frees nothing, nor does undoing or redoing that delete.
  test('deleting an imported session later leaves its bookmarks recorded', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['kitchen']), session: session('a') },
      ])
    );
    store.dispatch(deleteTabContainerInternal('a'));
    expect(idsOf(store.getState())).toEqual([]);
    expect(recorded(store.getState())).toEqual(['kitchen']);
    store.dispatch(undo());
    expect(idsOf(store.getState())).toEqual(['a']);
    expect(recorded(store.getState())).toEqual(['kitchen']);
    store.dispatch(redo());
    expect(idsOf(store.getState())).toEqual([]);
    expect(recorded(store.getState())).toEqual(['kitchen']);
  });

  // KAN-862 R21. Undoing the import is as if it never happened; redo makes it happen again.
  test('undoing the import frees what it recorded, and redo records it again', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['work']), session: session('w') },
      ])
    );
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['l1']), session: session('a') },
        { bookmarks: marks(['kitchen']), session: session('b') },
      ])
    );

    store.dispatch(undo());
    expect(idsOf(store.getState())).toEqual(['w']);
    expect(recorded(store.getState())).toEqual(['work']);
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}').importedBookmarks
    ).toEqual([
      { sessionId: 'w', bookmarks: marks(['work']), isUndone: false },
      { sessionId: 'a', bookmarks: marks(['l1']), isUndone: true },
      { sessionId: 'b', bookmarks: marks(['kitchen']), isUndone: true },
    ]);

    store.dispatch(redo());
    expect(idsOf(store.getState())).toEqual(['a', 'b', 'w']);
    expect(recorded(store.getState())).toEqual(['kitchen', 'l1', 'work']);
  });

  test('undoing a later step leaves the import recorded', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['kitchen']), session: session('a') },
      ])
    );
    store.dispatch(importBookmarkSessions(fromFolders([session('b')])));
    store.dispatch(undo());
    expect(recorded(store.getState())).toEqual(['kitchen']);
  });

  test('it makes hasHadSavedSession true', () => {
    const { store } = makeTestStore();
    expect(store.getState().settingsDataState.hasHadSavedSession).toBe(false);
    store.dispatch(importBookmarkSessions(fromFolders([session('a')])));
    expect(store.getState().settingsDataState.hasHadSavedSession).toBe(true);
  });

  test('it is no save: no review moment, no first-save pop, no shutter', () => {
    const { store, actions } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(fromFolders([session('a'), session('b')]))
    );
    const global = store.getState().globalState;
    expect(global.firstSavePops).toBe(0);
    expect(global.sessionSaves).toBe(0);
    expect(
      actions.filter((a) => a.type.endsWith('setPendingReviewAsk'))
    ).toEqual([]);
  });

  // CONTROL: a real first save on the same harness does all three, so the zeros above can fail.
  test('control: a first save does ping all three', async () => {
    const { store, actions } = makeTestStore();
    await store.dispatch(
      saveToTabContainer({ container: session('a'), scope: 'all-windows' })
    );
    const global = store.getState().globalState;
    expect(global.firstSavePops).toBe(1);
    expect(global.sessionSaves).toBe(1);
    expect(
      actions.filter((a) => a.type.endsWith('setPendingReviewAsk')).length
    ).toBeGreaterThan(0);
  });

  // A save's consequences from the middleware: the dirty flag that pushes to the cloud, and an undo step.
  test('it leaves the container dirty, as a save does', async () => {
    const saved = makeTestStore();
    await saved.store.dispatch(
      saveToTabContainer({ container: session('a'), scope: 'all-windows' })
    );
    expect(saved.store.getState().globalState.isDirty).toBe(true);

    const { store } = makeTestStore();
    expect(store.getState().globalState.isDirty).toBe(false);
    store.dispatch(
      importBookmarkSessions(fromFolders([session('a'), session('b')]))
    );
    expect(store.getState().globalState.isDirty).toBe(true);
  });

  test('it writes the sessions to local storage', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(fromFolders([session('a'), session('b')]))
    );
    const stored: { tabGroups: { tabGroupId: string }[] } = JSON.parse(
      localStorage.getItem('tabContainerData') ?? '{}'
    );
    expect(stored.tabGroups.map((g) => g.tabGroupId)).toEqual(['a', 'b']);
  });

  test('one undo takes both sessions back', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(fromFolders([session('a'), session('b')]))
    );
    expect(idsOf(store.getState())).toEqual(['a', 'b']);
    store.dispatch(undo());
    expect(idsOf(store.getState())).toEqual([]);
  });

  test('one toast says how many came in', async () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(fromFolders([session('a'), session('b')]))
    );
    await vi.waitFor(() =>
      expect(store.getState().globalState.toasts).toHaveLength(1)
    );
    const [toast] = store.getState().globalState.toasts;
    expect(toast.text).toBe(BOOKMARKS_IMPORTED_FRAME);
    expect(toast.params).toEqual({ count: 2 });
  });

  test('with skip duplicates on, a link in two ticked folders stays in both', () => {
    type Node = chrome.bookmarks.BookmarkTreeNode;
    const link = (id: string, url: string): Node => ({
      id,
      title: id,
      url,
      syncing: false,
    });
    const folder = (id: string, children: Node[]): Node => ({
      id,
      title: id,
      children,
      syncing: false,
    });
    const root = folder('0', [
      folder('p', [link('1', 'https://x.test/'), link('2', 'https://x.test/')]),
      folder('q', [link('3', 'https://x.test/'), link('4', 'https://y.test/')]),
    ]);
    const made = sessionsFor(root, new Set(['p', 'q']), {
      now: new Date(2026, 10, 15),
      ownOrigin: 'chrome-extension://abc/',
      untitled: 'Untitled',
      skipDuplicates: true,
      imported: new Set(),
    });
    expect(made.map((m) => m.session.tabCount)).toEqual([1, 2]);

    const { store } = makeTestStore();
    store.dispatch(importBookmarkSessions(made));
    const landed = store.getState().tabContainerDataState.tabGroups;
    expect(landed.map((g) => g.tabCount)).toEqual([1, 2]);
    for (const g of landed)
      expect(g.windows.flatMap((w) => w.tabs.map((t) => t.url))).toContain(
        'https://x.test/'
      );
  });
});

describe('importSizeRefusal', () => {
  const LIMIT = FIRESTORE_MAX_DOCUMENT_BYTES;
  const stateWith = (
    syncOn: boolean,
    existing: tabContainerData[] = [session('old')]
  ): RootState => {
    const { store } = makeTestStore();
    for (const s of existing)
      store.dispatch(importBookmarkSessions(fromFolders([s])));
    const state = store.getState();
    return {
      ...state,
      settingsDataState: {
        ...state.settingsDataState,
        isAutoSync: syncOn,
        cloudConsent: syncOn ? 'granted' : 'declined',
      },
    };
  };
  // The first call measures what is saved now, the second what it would be.
  const sizes = (before: number, after: number) =>
    vi
      .mocked(syncBytes)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

  test('null when sync is off, even for an import that would not fit', async () => {
    sizes(LIMIT - 1, LIMIT * 2);
    expect(
      await importSizeRefusal(stateWith(false), [session('a')], 'en')
    ).toBeNull();
  });

  test('null when the account was already over before the import', async () => {
    sizes(LIMIT + 1, LIMIT * 2);
    expect(
      await importSizeRefusal(stateWith(true), [session('a')], 'en')
    ).toBeNull();
  });

  test('null when it still fits', async () => {
    sizes(100, LIMIT);
    expect(
      await importSizeRefusal(stateWith(true), [session('a')], 'en')
    ).toBeNull();
  });

  test('says how much, and the limit, when it would push a fitting account over', async () => {
    sizes(LIMIT - 10, Math.round(LIMIT * 1.4));
    expect(
      await importSizeRefusal(stateWith(true), [session('a')], 'en')
    ).toEqual({ used: '1.4', limit: '1' });
  });

  test('measures the saved list, then the saved list plus the new sessions', async () => {
    sizes(1, 2);
    await importSizeRefusal(
      stateWith(true),
      [session('a'), session('b')],
      'en'
    );
    const [before, after] = vi
      .mocked(syncBytes)
      .mock.calls.map(([c]) => c.tabGroups.map((g) => g.tabGroupId));
    expect(before).toEqual(['old']);
    expect(after).toEqual(['a', 'b', 'old']);
  });
});
