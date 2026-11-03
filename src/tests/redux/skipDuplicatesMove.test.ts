import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load, and showSession reads
// window.location.search. In node, window is made globalThis itself.
const location = vi.hoisted(() => ({ search: '' }));
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
    location,
  });
});

// No DOM here: showSession's slide runs its update at once.
vi.mock('../../components/home/paneMotion', () => ({
  runPaneMotion: (update: () => void) => update(),
}));
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  type SessionMove,
  type TabMasterContainer,
  type tabContainerData,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { setSkipDuplicateTabs } from '../../redux/slices/settingsDataStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { endDragHold } from '../../redux/dragHold';
import { moveToSession } from '../../redux/moveToSession';
import { moveToNewSession } from '../../redux/moveToNewSession';
import {
  T0,
  container,
  group,
  s3,
  session,
  sessionIds,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-914. A move from one saved session to another leaves out pages the target has while Skip duplicate tabs is on; a left-out tab leaves the source too.

type Store = ReturnType<typeof makeTestStore>['store'];

const A = 'https://a.test/';
const B = 'https://b.test/';
const C = 'https://c.test/';

const at = (tabId: string, url: string, chromeGroupId?: string): tabData => ({
  ...tab(tabId, chromeGroupId),
  url,
});

const HOUR = 3_600_000;

// S1 the source: w1 a loose A, a group g1 of A and B, a loose C; w2 a window of A, B and C.
const source = (): tabContainerData =>
  session('S1', 'Source', T0 - 3 * HOUR, [
    win(
      'w1',
      [at('a1', A), at('ga', A, 'g1'), at('gb', B, 'g1'), at('c1', C)],
      [group('g1')]
    ),
    win('w2', [at('wa', A), at('wb', B), at('wc', C)]),
  ]);

// S2 the target already has A.
const target = (...tabs: tabData[]): tabContainerData =>
  session('S2', 'Target', T0 - 2 * HOUR, [
    win('d1', tabs.length > 0 ? tabs : [at('u1', A)]),
  ]);

const ready = (
  on: boolean,
  c: TabMasterContainer = container([s3(), target(), source()])
): Store => {
  const { store } = makeTestStore();
  store.dispatch(replaceState(c));
  store.dispatch(
    resetHistory({
      tabContainerDataState: store.getState().tabContainerDataState,
    })
  );
  store.dispatch(setIsNotDirty());
  store.dispatch(setSkipDuplicateTabs(on));
  return store;
};

const data = (store: Store) => store.getState().tabContainerDataState;
const urls = (store: Store, tabGroupId: string, windowId: string) =>
  windowIn(data(store), tabGroupId, windowId).tabs.map((t) => t.url);

const TAB_A: SessionMove = {
  carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'a1' },
  to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 },
};
const GROUP_G1: SessionMove = {
  carried: { kind: 'group', tabGroupId: 'S1', windowId: 'w1', groupId: 'g1' },
  to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 },
};
const WINDOW_W2: SessionMove = {
  carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
  to: { tabGroupId: 'S2', toIndex: 1 },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  endDragHold();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('KAN-914: a move between saved sessions with Skip duplicate tabs', () => {
  it('off: a move keeps repeats (today)', () => {
    const store = ready(false);
    store.dispatch(moveToSession({ move: TAB_A, announceMoved: true }));

    expect(urls(store, 'S2', 'd1')).toEqual([A, A]);
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).toEqual([
      'ga',
      'gb',
      'c1',
    ]);
  });

  it('tab whose page the target has leaves the source, target unchanged', () => {
    const store = ready(true);
    const targetBefore = structuredClone(sessionIn(data(store), 'S2'));

    vi.setSystemTime(T0 + 1_000);
    const moved = store.dispatch(
      moveToSession({ move: TAB_A, announceMoved: true })
    );

    expect(moved).toBe(true);
    expect(sessionIn(data(store), 'S2')).toEqual(targetBefore);
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).toEqual([
      'ga',
      'gb',
      'c1',
    ]);
    expect(sessionIn(data(store), 'S1').tabCount).toBe(6);
  });

  it('group move lands only new pages, group look kept', () => {
    const store = ready(true);
    store.dispatch(moveToSession({ move: GROUP_G1, announceMoved: true }));

    const d1 = windowIn(data(store), 'S2', 'd1');
    expect(d1.tabs.map((t) => t.url)).toEqual([A, B]);
    expect(d1.tabCount).toBe(2);
    expect(sessionIn(data(store), 'S2').tabCount).toBe(2);
    expect(d1.tabs[1].chromeGroupId).toBe('g1');
    expect(d1.chromeTabGroups).toEqual([group('g1')]);
    // Both of its tabs left the source, and its entry with them.
    const w1 = windowIn(data(store), 'S1', 'w1');
    expect(tabIds(w1)).toEqual(['a1', 'c1']);
    expect(w1.chromeTabGroups).toEqual([]);
  });

  it('window move lands only new pages, title kept; none new → nothing lands', () => {
    const store = ready(true);
    store.dispatch(moveToSession({ move: WINDOW_W2, announceMoved: true }));

    const s2 = sessionIn(data(store), 'S2');
    expect(s2.windows.map((w) => w.title)).toEqual(['Window d1', 'Window w2']);
    expect(s2.windows[1].tabs.map((t) => t.url)).toEqual([B, C]);
    expect(s2.windows[1].tabCount).toBe(2);
    expect(s2.tabCount).toBe(3);
    expect(sessionIn(data(store), 'S1').windows.map((w) => w.windowId)).toEqual(
      ['w1']
    );

    // A window whose every page is there lands nothing and leaves its source.
    const all = ready(
      true,
      container([s3(), target(at('u1', A), at('u2', B), at('u3', C)), source()])
    );
    const targetBefore = structuredClone(sessionIn(data(all), 'S2'));
    all.dispatch(moveToSession({ move: WINDOW_W2, announceMoved: true }));

    expect(sessionIn(data(all), 'S2')).toEqual(targetBefore);
    expect(sessionIn(data(all), 'S1').windows.map((w) => w.windowId)).toEqual([
      'w1',
    ]);
  });

  it('a window whose active tab is left out lands with none marked active', () => {
    const activeOn = (tabId: string): tabContainerData => {
      const c = source();
      c.windows[1] = { ...c.windows[1], activeTabId: tabId };
      return c;
    };
    const gone = ready(true, container([s3(), target(), activeOn('wa')]));
    gone.dispatch(moveToSession({ move: WINDOW_W2, announceMoved: true }));
    expect(windowIn(data(gone), 'S2', 'w2').activeTabId).toBeUndefined();

    // CONTROL: an active tab that arrives stays the active one.
    const kept = ready(true, container([s3(), target(), activeOn('wb')]));
    kept.dispatch(moveToSession({ move: WINDOW_W2, announceMoved: true }));
    expect(windowIn(data(kept), 'S2', 'w2').activeTabId).toBe('wb');
  });

  it('split pair rule', () => {
    const pair = (): tabContainerData =>
      session('S1', 'Source', T0 - 3 * HOUR, [
        win('w1', [at('keep', C)]),
        win('w2', [
          { ...at('pa', A), splitId: 's' },
          { ...at('pb', B), splitId: 's' },
          at('pc', C),
        ]),
      ]);

    // One half there: the pair arrives whole.
    const half = ready(true, container([s3(), target(at('u1', A)), pair()]));
    half.dispatch(moveToSession({ move: WINDOW_W2, announceMoved: true }));
    expect(urls(half, 'S2', 'w2')).toEqual([A, B, C]);

    // Both halves there: the pair is left out.
    const both = ready(
      true,
      container([s3(), target(at('u1', A), at('u2', B)), pair()])
    );
    both.dispatch(moveToSession({ move: WINDOW_W2, announceMoved: true }));
    expect(urls(both, 'S2', 'w2')).toEqual([C]);
  });

  it('same-session move ignores the flag', () => {
    const store = ready(true);
    const intoNewWindow: SessionMove = {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 'wa' },
      to: { tabGroupId: 'S1', newWindowId: 'nw', at: 'first' },
    };
    store.dispatch(
      moveToSession({ move: intoNewWindow, announceMoved: false })
    );

    expect(urls(store, 'S1', 'nw')).toEqual([A]);
    expect(sessionIn(data(store), 'S1').tabCount).toBe(7);
  });

  it('new session from a carried window keeps one copy of each', () => {
    const repeats = (): tabContainerData =>
      session('S1', 'Source', T0 - 3 * HOUR, [
        win('w1', [at('keep', C)]),
        win('w2', [at('ra', A), at('rb', B), at('ra2', A)]),
      ]);
    const store = ready(true, container([s3(), target(), repeats()]));
    const moved = store.dispatch(
      moveToNewSession(
        { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
        'Fallback'
      )
    );

    expect(moved).toBe(true);
    const made = data(store).tabGroups.find(
      (g) => !['S1', 'S2', 'S3'].includes(g.tabGroupId)
    );
    expect(made?.windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      [A, B],
    ]);
    expect(made?.tabCount).toBe(2);
    // The repeat went with it, out of the source.
    expect(sessionIn(data(store), 'S1').windows.map((w) => w.windowId)).toEqual(
      ['w1']
    );
  });

  it('all-there move empties the source; undo restores both', () => {
    const lonely = (): tabContainerData =>
      session('S1', 'Source', T0 - 3 * HOUR, [win('w9', [at('la', A)])]);
    const store = ready(true, container([s3(), target(), lonely()], 'S1'));
    const before = structuredClone(data(store));
    const past = store.getState().undoRedo.past.length;

    vi.setSystemTime(T0 + 1_000);
    store.dispatch(
      moveToSession({
        move: {
          carried: {
            kind: 'tab',
            tabGroupId: 'S1',
            windowId: 'w9',
            tabId: 'la',
          },
          to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
        },
        announceMoved: true,
      })
    );

    expect(sessionIds(data(store))).toEqual(['S3', 'S2']);
    // Unchanged but for being shown in the gone source's place (Q4 A).
    expect({ ...sessionIn(data(store), 'S2'), isSelected: false }).toEqual(
      sessionIn(before, 'S2')
    );
    expect(data(store).selectedTabGroupId).toBe('S2');
    expect(store.getState().undoRedo.past.length).toBe(past + 1);

    vi.setSystemTime(T0 + 2_000);
    store.dispatch(undo());

    const withoutStamp = (g: tabContainerData) => ({
      ...g,
      lastModified: undefined,
    });
    const restored = data(store);
    expect(restored.tabGroups.map(withoutStamp)).toEqual(
      before.tabGroups.map(withoutStamp)
    );
    expect(restored.selectedTabGroupId).toBe('S1');
    expect(restored.deletedTabGroups ?? []).toEqual([]);
  });
});
