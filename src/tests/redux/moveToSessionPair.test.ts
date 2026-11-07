import { describe, expect, it, vi } from 'vitest';

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

vi.mock('../../components/home/paneMotion', () => ({
  runPaneMotion: (update: () => void) => update(),
}));
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  NEW_FIRST_WINDOW,
  NEW_LAST_WINDOW,
} from '../../components/home/rightpane/newWindowTarget';
import { dropCarriedTab } from '../../redux/dropCarried';
import { dropOnSessionRow } from '../../redux/dropOnSessionRow';
import { endDragHold } from '../../redux/dragHold';
import { moveToNewSession } from '../../redux/moveToNewSession';
import { moveToSession } from '../../redux/moveToSession';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { setSkipDuplicateTabs } from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  type CarriedRef,
  type SessionMove,
  type TabMasterContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { splitPairs } from '../../utils/functions/savedPairs';
import {
  T0,
  container,
  group,
  session,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-942. A saved pair between sessions: S1 w1 [t1, h1, h2, t2], w2 [t3]; S2 d1 [u1, u2*b, u3*b], d2 [u4].

type Store = ReturnType<typeof makeTestStore>['store'];

const half = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  ...tab(tabId),
  splitId: 'split',
  ...extra,
});

const source = (
  tabs: tabData[] = [tab('t1'), half('h1'), half('h2'), tab('t2')]
) =>
  session('S1', 'Source', T0 - 3_000, [
    win('w1', tabs),
    win('w2', [tab('t3')]),
  ]);
const target = () =>
  session('S2', 'Target', T0 - 2_000, [
    win('d1', [tab('u1'), tab('u2', 'b'), tab('u3', 'b')], [group('b')]),
    win('d2', [tab('u4')]),
  ]);

const ready = (
  c: TabMasterContainer = container([target(), source()], 'S1')
): Store => {
  const { store } = makeTestStore();
  store.dispatch(replaceState(c));
  store.dispatch(
    resetHistory({
      tabContainerDataState: store.getState().tabContainerDataState,
    })
  );
  store.dispatch(setIsNotDirty());
  return store;
};

const data = (s: Store) => s.getState().tabContainerDataState;
const PAIR: Extract<CarriedRef, { kind: 'pair' }> = {
  kind: 'pair',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 'h1',
  partnerTabId: 'h2',
};
const toSpot = (toIndex: number, toChromeGroupId?: string): SessionMove => ({
  carried: PAIR,
  to: { tabGroupId: 'S2', windowId: 'd1', toIndex, toChromeGroupId },
});
const moved = (s: Store, move: SessionMove) =>
  s.dispatch(moveToSession({ move, announceMoved: false }));
const isPair = (tabs: readonly tabData[]) => splitPairs(tabs).length === 1;

describe('a saved pair moved to another session (KAN-942)', () => {
  it('lands side by side, same splitId, and leaves the source', () => {
    const s = ready();
    expect(moved(s, toSpot(1))).toBe(true);
    const d1 = windowIn(data(s), 'S2', 'd1');
    expect(tabIds(d1)).toEqual(['u1', 'h1', 'h2', 'u2', 'u3']);
    expect(isPair(d1.tabs)).toBe(true);
    expect(tabIds(windowIn(data(s), 'S1', 'w1'))).toEqual(['t1', 't2']);
    expect(sessionIn(data(s), 'S2').tabCount).toBe(6);
    expect(sessionIn(data(s), 'S1').tabCount).toBe(3);
  });

  it('keeps one pin, read from where it lands', () => {
    const pinned = session('S2', 'Target', T0 - 2_000, [
      win('d1', [
        { ...tab('p'), pinned: true },
        { ...tab('q'), pinned: true },
        tab('r'),
      ]),
    ]);
    const s = ready(container([pinned, source()], 'S1'));
    moved(s, toSpot(1));
    const d1 = windowIn(data(s), 'S2', 'd1');
    expect(tabIds(d1)).toEqual(['p', 'h1', 'h2', 'q', 'r']);
    expect(d1.tabs[1].pinned).toBe(true);
    expect(d1.tabs[2].pinned).toBe(true);
  });

  it('into a band: both join', () => {
    const s = ready();
    moved(s, toSpot(2, 'b'));
    const d1 = windowIn(data(s), 'S2', 'd1');
    expect(tabIds(d1)).toEqual(['u1', 'u2', 'h1', 'h2', 'u3']);
    expect(d1.tabs[2].chromeGroupId).toBe('b');
    expect(d1.tabs[3].chromeGroupId).toBe('b');
  });

  it('out of a group: loose, and an emptied group loses its entry', () => {
    const grouped = session('S1', 'Source', T0 - 3_000, [
      win(
        'w1',
        [
          tab('t1'),
          half('h1', { chromeGroupId: 'g' }),
          half('h2', { chromeGroupId: 'g' }),
        ],
        [group('g')]
      ),
    ]);
    const s = ready(container([target(), grouped], 'S1'));
    moved(s, toSpot(0));
    const d1 = windowIn(data(s), 'S2', 'd1');
    expect(d1.tabs[0].chromeGroupId).toBeUndefined();
    expect(d1.tabs[1].chromeGroupId).toBeUndefined();
    expect(windowIn(data(s), 'S1', 'w1').chromeTabGroups).toEqual([]);
  });

  it('a new first window holds the two tabs', () => {
    const s = ready();
    moved(s, {
      carried: PAIR,
      to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'first' },
    });
    const first = sessionIn(data(s), 'S2').windows[0];
    expect(tabIds(first)).toEqual(['h1', 'h2']);
    expect(isPair(first.tabs)).toBe(true);
  });

  it('a new last window in its own session holds the two tabs', () => {
    const s = ready();
    moved(s, {
      carried: PAIR,
      to: { tabGroupId: 'S1', newWindowId: 'nw', at: 'last' },
    });
    const windows = sessionIn(data(s), 'S1').windows;
    expect(tabIds(windows[windows.length - 1])).toEqual(['h1', 'h2']);
  });

  it('a pair that is all of its window, to a new window where it stands, is no edit', () => {
    const alone = session('S1', 'Source', T0 - 3_000, [
      win('w1', [half('h1'), half('h2')]),
      win('w2', [tab('t3')]),
    ]);
    const s = ready(container([target(), alone], 'S1'));
    const before = data(s);
    moved(s, {
      carried: PAIR,
      to: { tabGroupId: 'S1', newWindowId: 'nw', at: 'first' },
    });
    expect(data(s)).toBe(before);
  });

  it('a pair sharing its window, to a new window, moves', () => {
    const s = ready();
    moved(s, {
      carried: PAIR,
      to: { tabGroupId: 'S1', newWindowId: 'nw', at: 'first' },
    });
    expect(tabIds(sessionIn(data(s), 'S1').windows[0])).toEqual(['h1', 'h2']);
  });

  it('a window already holding that splitId: both pairs stay pairs', () => {
    const twin = session('S2', 'Target', T0 - 2_000, [
      win('d1', [half('a1'), half('a2'), tab('u1')]),
    ]);
    const s = ready(container([twin, source()], 'S1'));
    moved(s, toSpot(2));
    const d1 = windowIn(data(s), 'S2', 'd1');
    expect(tabIds(d1)).toEqual(['a1', 'a2', 'h1', 'h2', 'u1']);
    expect(splitPairs(d1.tabs)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('a slot inside a pair lands past it', () => {
    const paired = session('S2', 'Target', T0 - 2_000, [
      win('d1', [
        { ...tab('p1'), splitId: 'other' },
        { ...tab('p2'), splitId: 'other' },
      ]),
    ]);
    const s = ready(container([paired, source()], 'S1'));
    moved(s, toSpot(1));
    expect(tabIds(windowIn(data(s), 'S2', 'd1'))).toEqual([
      'p1',
      'p2',
      'h1',
      'h2',
    ]);
  });

  it('refuses a pair that stopped being one', () => {
    const broken = source([half('h1'), tab('m'), half('h2')]);
    const s = ready(container([target(), broken], 'S1'));
    const before = data(s);
    expect(moved(s, toSpot(1))).toBe(false);
    expect(data(s)).toBe(before);
  });

  it('one undo brings both back to both sessions', () => {
    const s = ready();
    moved(s, toSpot(1));
    s.dispatch(undo());
    expect(tabIds(windowIn(data(s), 'S1', 'w1'))).toEqual([
      't1',
      'h1',
      'h2',
      't2',
    ]);
    expect(tabIds(windowIn(data(s), 'S2', 'd1'))).toEqual(['u1', 'u2', 'u3']);
  });
});

describe('Skip duplicate tabs (KAN-942)', () => {
  const repeating = (...urls: string[]) =>
    session('S2', 'Target', T0 - 2_000, [
      win(
        'd1',
        urls.map((url, i) => ({ ...tab(`r${i}`), url }))
      ),
    ]);

  it('one half repeated: the pair lands whole', () => {
    const s = ready(container([repeating(tab('h1').url), source()], 'S1'));
    s.dispatch(setSkipDuplicateTabs(true));
    moved(s, toSpot(1));
    expect(tabIds(windowIn(data(s), 'S2', 'd1'))).toEqual(['r0', 'h1', 'h2']);
  });

  it('both halves repeated: nothing lands, and the toast counts two', () => {
    const s = ready(
      container([repeating(tab('h1').url, tab('h2').url), source()], 'S1')
    );
    s.dispatch(setSkipDuplicateTabs(true));
    moved(s, toSpot(1));
    expect(tabIds(windowIn(data(s), 'S2', 'd1'))).toEqual(['r0', 'r1']);
    expect(tabIds(windowIn(data(s), 'S1', 'w1'))).toEqual(['t1', 't2']);
    expect(s.getState().globalState.toasts.map((x) => x.params)).toEqual([
      { count: 2 },
    ]);
  });
});

describe('a pair on the session rows (KAN-942)', () => {
  it('a session row makes the pair its first window, one undo step', () => {
    const s = ready();
    expect(s.dispatch(dropOnSessionRow(PAIR, 'S2'))).toBe(true);
    expect(tabIds(sessionIn(data(s), 'S2').windows[0])).toEqual(['h1', 'h2']);
    s.dispatch(undo());
    expect(tabIds(windowIn(data(s), 'S1', 'w1'))).toEqual([
      't1',
      'h1',
      'h2',
      't2',
    ]);
  });

  it('the save row makes a session of the two, titled by the head', () => {
    const s = ready();
    expect(s.dispatch(moveToNewSession(PAIR, 'Fallback'))).toBe(true);
    const made = data(s).tabGroups[0];
    expect(made.title).toBe('h1');
    expect(tabIds(made.windows[0])).toEqual(['h1', 'h2']);
    expect(isPair(made.windows[0].tabs)).toBe(true);
  });

  it('the save row refuses a pair that stopped being one', () => {
    const broken = source([half('h1'), tab('m'), half('h2')]);
    const s = ready(container([target(), broken], 'S1'));
    expect(s.dispatch(moveToNewSession(PAIR, 'Fallback'))).toBe(false);
  });
});

describe('dropCarriedTab with a pair (KAN-942)', () => {
  const inOwnSession = (toIndex: number, toWindowId = 'w1') =>
    dropCarriedTab(PAIR, { tabGroupId: 'S1', toWindowId, toIndex });

  it('its own session, one move, one undo step', () => {
    const s = ready();
    expect(s.dispatch(inOwnSession(2))).toBe(true);
    expect(tabIds(windowIn(data(s), 'S1', 'w1'))).toEqual([
      't1',
      't2',
      'h1',
      'h2',
    ]);
    s.dispatch(undo());
    expect(tabIds(windowIn(data(s), 'S1', 'w1'))).toEqual([
      't1',
      'h1',
      'h2',
      't2',
    ]);
    endDragHold();
  });

  it('another window of its session', () => {
    const s = ready();
    expect(s.dispatch(inOwnSession(1, 'w2'))).toBe(true);
    expect(tabIds(windowIn(data(s), 'S1', 'w2'))).toEqual(['t3', 'h1', 'h2']);
  });

  it('put back at its own place moves nothing', () => {
    const s = ready();
    expect(s.dispatch(inOwnSession(1))).toBe(false);
  });

  it('another session, at a spot', () => {
    const s = ready();
    expect(
      s.dispatch(
        dropCarriedTab(PAIR, { tabGroupId: 'S2', toWindowId: 'd2', toIndex: 0 })
      )
    ).toBe(true);
    expect(tabIds(windowIn(data(s), 'S2', 'd2'))).toEqual(['h1', 'h2', 'u4']);
  });

  it.each([
    [NEW_FIRST_WINDOW, 0],
    [NEW_LAST_WINDOW, 2],
  ])('the New window target %s', (toWindowId, at) => {
    const s = ready();
    expect(
      s.dispatch(
        dropCarriedTab(PAIR, { tabGroupId: 'S1', toWindowId, toIndex: 0 })
      )
    ).toBe(true);
    expect(tabIds(sessionIn(data(s), 'S1').windows[at])).toEqual(['h1', 'h2']);
  });
});
