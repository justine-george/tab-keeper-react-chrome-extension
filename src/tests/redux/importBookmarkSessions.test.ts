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
  selectImportedSessionIds,
} from '../../redux/bookmarkImport';
import {
  saveToTabContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { RootState } from '../../redux/store';
import { syncBytes } from '../../utils/functions/cloudDocument';
import { sessionsFor } from '../../utils/functions/bookmarkImport';
import { FIRESTORE_MAX_DOCUMENT_BYTES } from '../../utils/functions/local';
import { BOOKMARKS_IMPORTED_FRAME } from '../../utils/constants/common';

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
      importBookmarkSessions([session('c'), session('b'), session('a')])
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
    store.dispatch(importBookmarkSessions([session('a'), session('b')]));
    expect(selectImportedSessionIds(store.getState())).toEqual(['a', 'b']);
    store.dispatch(importBookmarkSessions([session('c')]));
    expect(selectImportedSessionIds(store.getState())).toEqual(['a', 'b', 'c']);
  });

  test('it makes hasHadSavedSession true', () => {
    const { store } = makeTestStore();
    expect(store.getState().settingsDataState.hasHadSavedSession).toBe(false);
    store.dispatch(importBookmarkSessions([session('a')]));
    expect(store.getState().settingsDataState.hasHadSavedSession).toBe(true);
  });

  test('it is no save: no review moment, no first-save pop, no shutter', async () => {
    const { store, actions } = makeTestStore();
    store.dispatch(importBookmarkSessions([session('a'), session('b')]));
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

  test('one toast says how many came in', async () => {
    const { store } = makeTestStore();
    store.dispatch(importBookmarkSessions([session('a'), session('b')]));
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
    });
    expect(made.map((s) => s.tabCount)).toEqual([1, 2]);

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
    for (const s of existing) store.dispatch(importBookmarkSessions([s]));
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
