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
  deleteTabInternal,
  moveToNewSessionInternal,
  restoreDeletedSessionInternal,
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

// The bookmark ids that count as imported now (R25: only a saved session's), sorted. Fixtures carry no dateAdded.
const recorded = (state: RootState) =>
  [
    ...importedBookmarkKeys(
      selectImportedBookmarks(state),
      state.tabContainerDataState.tabGroups
    ),
  ]
    .map((key) => key.replace(/@$/, ''))
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

  // KAN-862 (11-16 13:05). The import is no edit: the date line says "Imported from bookmarks" until one.
  test('an imported session lands unedited, keeping its mark; an edit to it stamps it and keeps the mark', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(
        fromFolders([
          { ...session('a'), importedFrom: 'bookmarks' },
          { ...session('b'), importedFrom: 'bookmarks' },
        ])
      )
    );
    const byId = (id: string) =>
      store
        .getState()
        .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id);
    expect(byId('a')?.contentModified).toBeUndefined();
    expect(byId('b')?.contentModified).toBeUndefined();
    expect(byId('a')?.importedFrom).toBe('bookmarks');

    store.dispatch(
      deleteTabInternal({ tabGroupId: 'a', windowId: 'a-w', tabId: 'a-t0' })
    );
    expect(byId('a')?.contentModified).toEqual(expect.any(Number));
    expect(byId('a')?.importedFrom).toBe('bookmarks');
  });

  // A tab moved out to a new session makes a session of the user's own: no mark goes with it.
  test('a new session made from an imported one carries no mark', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions(
        fromFolders([{ ...session('a'), importedFrom: 'bookmarks' }])
      )
    );
    store.dispatch(
      moveToNewSessionInternal(
        { kind: 'tab', tabGroupId: 'a', windowId: 'a-w', tabId: 'a-t0' },
        'Fallback',
        '',
        { tabGroupId: 'mine' }
      )
    );
    const groups = store.getState().tabContainerDataState.tabGroups;
    expect(groups.find((g) => g.tabGroupId === 'mine')?.tabCount).toBe(1);
    expect(groups.find((g) => g.tabGroupId === 'mine')).not.toHaveProperty(
      'importedFrom'
    );
    expect(groups.find((g) => g.tabGroupId === 'a')?.importedFrom).toBe(
      'bookmarks'
    );
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
      { sessionId: 'a', bookmarks: marks(['l1', 'l3']) },
      { sessionId: 'b', bookmarks: marks(['kitchen']) },
      { sessionId: 'c', bookmarks: marks(['work']) },
    ]);
  });

  // KAN-862 R25. The keys the tree checks: id and dateAdded, and only of entries whose session is saved.
  test('importedBookmarkKeys keys each entry with a saved session by id and dateAdded', () => {
    expect(
      [
        ...importedBookmarkKeys(
          [
            { sessionId: 'a', bookmarks: [{ id: '7', dateAdded: 1000 }] },
            { sessionId: 'b', bookmarks: marks(['8']) },
            { sessionId: 'gone', bookmarks: marks(['9']) },
          ],
          [session('a'), session('b'), session('unrelated')]
        ),
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

  test('importedBookmarkKeys: no saved sessions, nothing counts', () => {
    expect(
      importedBookmarkKeys([{ sessionId: 'a', bookmarks: marks(['7']) }], [])
        .size
    ).toBe(0);
  });

  // Re-imported after its first session was deleted: either live session keeps it imported.
  test('importedBookmarkKeys: two entries for one bookmark count it while either session is saved', () => {
    const entries = [
      { sessionId: 'first', bookmarks: marks(['kitchen']) },
      { sessionId: 'again', bookmarks: marks(['kitchen']) },
    ];
    const kitchen = identityKey({ id: 'kitchen', dateAdded: null });
    expect([...importedBookmarkKeys(entries, [session('again')])]).toEqual([
      kitchen,
    ]);
    expect([...importedBookmarkKeys(entries, [session('first')])]).toEqual([
      kitchen,
    ]);
  });

  // KAN-862 R25 (his pick 11-16 04:28). Deleting the session frees its bookmarks; restoring or undoing the delete takes them again.
  test('deleting an imported session frees its bookmarks, and restoring it counts them again', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['kitchen']), session: session('a') },
        { bookmarks: marks(['work']), session: session('w') },
      ])
    );
    expect(recorded(store.getState())).toEqual(['kitchen', 'work']);

    const deleted = store
      .getState()
      .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'a');
    if (deleted === undefined) throw new Error('no session a');
    store.dispatch(deleteTabContainerInternal('a'));
    expect(idsOf(store.getState())).toEqual(['w']);
    expect(recorded(store.getState())).toEqual(['work']);
    // The entry stays: it is what makes a restore count again.
    expect(
      selectImportedBookmarks(store.getState()).map((e) => e.sessionId)
    ).toEqual(['a', 'w']);

    store.dispatch(undo());
    expect(idsOf(store.getState()).sort()).toEqual(['a', 'w']);
    expect(recorded(store.getState())).toEqual(['kitchen', 'work']);
    store.dispatch(redo());
    expect(idsOf(store.getState())).toEqual(['w']);
    expect(recorded(store.getState())).toEqual(['work']);

    store.dispatch(restoreDeletedSessionInternal(deleted));
    expect(idsOf(store.getState()).sort()).toEqual(['a', 'w']);
    expect(recorded(store.getState())).toEqual(['kitchen', 'work']);
  });

  // Re-imported while the old session sat in Recently deleted, then that one restored: two copies, both counted.
  test('a re-import after a delete keeps it imported whichever session is deleted next', () => {
    const { store } = makeTestStore();
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['kitchen']), session: session('first') },
      ])
    );
    store.dispatch(deleteTabContainerInternal('first'));
    expect(recorded(store.getState())).toEqual([]);
    store.dispatch(
      importBookmarkSessions([
        { bookmarks: marks(['kitchen']), session: session('again') },
      ])
    );
    expect(recorded(store.getState())).toEqual(['kitchen']);
    store.dispatch(deleteTabContainerInternal('again'));
    expect(recorded(store.getState())).toEqual([]);
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
    // Its entries stay, so the redo below counts them again.
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}').importedBookmarks
    ).toEqual([
      { sessionId: 'w', bookmarks: marks(['work']) },
      { sessionId: 'a', bookmarks: marks(['l1']) },
      { sessionId: 'b', bookmarks: marks(['kitchen']) },
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
