import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
}));

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  renameSavedTab,
  saveToTabContainerInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { redo, undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

const PAGE_TITLE = 'Alex Jo on X: "Sync is hard" / X';
const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

function session(): tabContainerData {
  return {
    tabGroupId: 's1',
    title: 'Alpha',
    createdTime: '2026-10-26 12:00:00',
    createdAt: T0,
    windowCount: 1,
    tabCount: 2,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 2,
        title: 'window',
        tabs: [
          {
            tabId: 't1',
            favicon: '',
            title: PAGE_TITLE,
            url: 'https://x.com/alexjo/status/1',
          },
          // Chrome hands over page titles untrimmed.
          {
            tabId: 't2',
            favicon: '',
            title: 'Kagi ',
            url: 'https://kagi.com/',
          },
        ],
      },
    ],
  };
}

type Store = ReturnType<typeof makeTestStore>['store'];

const seeded = (): Store => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(session()));
  return store;
};

const tabOf = (s: Store, tabId = 't1'): tabData | undefined =>
  s
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 's1')
    ?.windows[0].tabs.find((t) => t.tabId === tabId);

const rename = (
  s: Store,
  name: string,
  ids: Partial<Record<string, string>> = {}
) =>
  s.dispatch(
    renameSavedTab({
      tabGroupId: ids.tabGroupId ?? 's1',
      windowId: ids.windowId ?? 'w1',
      tabId: ids.tabId ?? 't1',
      name,
    })
  );

describe('renameSavedTab (KAN-824)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives the tab a name of its own and keeps the page title', () => {
    const store = seeded();
    rename(store, 'Sync notes');
    expect(tabOf(store)).toMatchObject({
      title: PAGE_TITLE,
      customTitle: 'Sync notes',
    });
    // The other tab is untouched.
    expect(tabOf(store, 't2')).not.toHaveProperty('customTitle');
  });

  it('stores the name trimmed', () => {
    const store = seeded();
    rename(store, '  Sync notes  ');
    expect(tabOf(store)?.customTitle).toBe('Sync notes');
  });

  it.each([
    ['an empty name', ''],
    ['a whitespace-only name', '   '],
    ['the page title itself', PAGE_TITLE],
    ['the page title with stray spaces', ` ${PAGE_TITLE} `],
  ])('%s removes the custom name', (_label, name) => {
    const store = seeded();
    rename(store, 'Sync notes');
    rename(store, name);
    expect(tabOf(store)).not.toHaveProperty('customTitle');
    expect(tabOf(store)?.title).toBe(PAGE_TITLE);
  });

  it('keeps no name when the field holds an untrimmed page title, trimmed', () => {
    const store = seeded();
    const before = store.getState().tabContainerDataState;
    rename(store, 'Kagi', { tabId: 't2' });
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  it('stamps the session and the container when it changes the name', () => {
    const store = seeded();
    vi.setSystemTime(T0 + 5_000);
    rename(store, 'Sync notes');
    const state = store.getState().tabContainerDataState;
    expect(state.lastModified).toBe(T0 + 5_000);
    expect(state.tabGroups[0].contentModified).toBe(T0 + 5_000);
  });

  it('writes nothing when the name is unchanged', () => {
    const store = seeded();
    rename(store, 'Sync notes');
    const before = store.getState().tabContainerDataState;
    vi.setSystemTime(T0 + 5_000);
    rename(store, ' Sync notes ');
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  it('writes nothing when an unnamed tab is "renamed" to its page title', () => {
    const store = seeded();
    const before = store.getState().tabContainerDataState;
    rename(store, PAGE_TITLE);
    rename(store, '');
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  it.each([
    ['session', { tabGroupId: 'nope' }],
    ['window', { windowId: 'nope' }],
    ['tab', { tabId: 'nope' }],
  ])('an unknown %s is a no-op', (_label, ids) => {
    const store = seeded();
    const before = store.getState().tabContainerDataState;
    rename(store, 'Sync notes', ids);
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  it('is saved to local storage, so it survives a reload', () => {
    const store = seeded();
    rename(store, 'Sync notes');
    const stored = JSON.parse(localStorage.getItem('tabContainerData') ?? '{}');
    expect(stored.tabGroups[0].windows[0].tabs[0].customTitle).toBe(
      'Sync notes'
    );
  });

  it('is one undo step, and redo puts it back', () => {
    const store = seeded();
    rename(store, 'Sync notes');

    store.dispatch(undo());
    expect(tabOf(store)).not.toHaveProperty('customTitle');
    expect(tabOf(store)?.title).toBe(PAGE_TITLE);

    store.dispatch(redo());
    expect(tabOf(store)?.customTitle).toBe('Sync notes');
  });
});

// The KAN-55 hole, one level further down: undoing a rename hands the merge a
// session whose only difference from the cloud copy is the tab's customTitle.
// If the content comparator ignores that field, the undo gets no fresh stamp
// and the cloud's renamed copy wins the next sync.
describe('undoing a tab rename survives the next sync (KAN-824)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the page title the user went back to', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(saveToTabContainerInternal(session()));

    rename(store, 'Sync notes');
    const cloudAfterRename = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    expect(tabOf(store)).not.toHaveProperty('customTitle');

    mocks.loadFromFirestore.mockResolvedValue(cloudAfterRename);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(tabOf(store)).not.toHaveProperty('customTitle');
  });
});
