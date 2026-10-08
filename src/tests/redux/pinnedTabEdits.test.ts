import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  addCurrTabToChromeGroupInternal,
  addCurrTabToWindowInternal,
  deleteChromeTabGroupInternal,
  deleteTabInternal,
  moveChromeGroupAcrossWindowsInternal,
  moveChromeGroupInternal,
  moveTabAcrossWindowsInternal,
  moveTabInternal,
  moveToNewSessionInternal,
  moveToSessionInternal,
  replaceState,
  saveToTabContainerInternal,
  type CarriedRef,
  type TabMasterContainer,
  type tabContainerData,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
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

// KAN-458. Position decides the pin, through the reducers the app dispatches; every tab lands at the index it was given.
const pinned = (tabId: string): tabData => ({ ...tab(tabId), pinned: true });

// S1 w1: two pinned tabs, the active loose tab t1, a band g1, a loose t2. w2: one tab.
const s1 = (): tabContainerData =>
  session('S1', 'Source', T0 - 3_000, [
    {
      ...win(
        'w1',
        [
          pinned('p1'),
          pinned('p2'),
          tab('t1'),
          tab('g1a', 'g1'),
          tab('g1b', 'g1'),
          tab('t2'),
        ],
        [group('g1')]
      ),
      activeTabId: 't1',
    },
    win('w2', [tab('t3')]),
  ]);

// S2 d1: a pinned tab, a loose tab, a band h1. d2: a one-member band k1.
const s2 = (): tabContainerData =>
  session('S2', 'Target', T0 - 2_000, [
    win('d1', [pinned('q1'), tab('u1'), tab('u2', 'h1')], [group('h1')]),
    win('d2', [tab('x1', 'k1')], [group('k1')]),
  ]);

const activeIs = (
  s: tabContainerData,
  activeTabId: string
): tabContainerData => ({
  ...s,
  windows: s.windows.map((w, i) => (i === 0 ? { ...w, activeTabId } : w)),
});

const base = (sessions = [s2(), s1()]): TabMasterContainer =>
  reducer(undefined, replaceState(container(sessions)));

const NOW = T0 + 10_000;
const pins = (c: TabMasterContainer, s: string, w: string) =>
  windowIn(c, s, w).tabs.map((t) => t.pinned === true);
const within1 = (tabId: string, toIndex: number, toChromeGroupId?: string) =>
  moveTabInternal({
    tabGroupId: 'S1',
    windowId: 'w1',
    tabId,
    toIndex,
    ...(toChromeGroupId === undefined ? {} : { toChromeGroupId }),
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('within a window (moveTabInternal)', () => {
  it('an unpinned tab dropped above the pinned tabs lands there, pinned', () => {
    const next = reducer(base(), within1('t2', 0));
    expect(tabIds(windowIn(next, 'S1', 'w1'))).toEqual([
      't2',
      'p1',
      'p2',
      't1',
      'g1a',
      'g1b',
    ]);
    expect(pins(next, 'S1', 'w1')).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(sessionIn(next, 'S1').contentModified).toBe(NOW);
  });

  it('an unpinned tab dropped between two pinned tabs lands there, pinned', () => {
    const next = reducer(base(), within1('t1', 1));
    expect(tabIds(windowIn(next, 'S1', 'w1')).slice(0, 3)).toEqual([
      'p1',
      't1',
      'p2',
    ]);
    expect(pins(next, 'S1', 'w1').slice(0, 4)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('a pinned tab dropped among the unpinned tabs lands there, unpinned', () => {
    const next = reducer(base(), within1('p1', 5));
    expect(tabIds(windowIn(next, 'S1', 'w1'))).toEqual([
      'p2',
      't1',
      'g1a',
      'g1b',
      't2',
      'p1',
    ]);
    expect(pins(next, 'S1', 'w1')).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('a pinned tab dropped into a band lands there, in the group, unpinned (A6)', () => {
    const next = reducer(base(), within1('p1', 3, 'g1'));
    const w1 = windowIn(next, 'S1', 'w1');
    expect(tabIds(w1)).toEqual(['p2', 't1', 'g1a', 'p1', 'g1b', 't2']);
    expect(w1.tabs[3].chromeGroupId).toBe('g1');
    expect('pinned' in w1.tabs[3]).toBe(false);
  });

  it('a pinned tab dropped into a band on the boundary is unpinned: the band wins (A6)', () => {
    const v = session('S5', 'Band', T0 - 1_000, [
      win(
        'v1',
        [pinned('pa'), pinned('pb'), tab('ga', 'gg'), tab('gb', 'gg')],
        [group('gg')]
      ),
    ]);
    const next = reducer(
      base([v]),
      moveTabInternal({
        tabGroupId: 'S5',
        windowId: 'v1',
        tabId: 'pb',
        toIndex: 1,
        toChromeGroupId: 'gg',
      })
    );
    const v1 = windowIn(next, 'S5', 'v1');
    expect(tabIds(v1)).toEqual(['pa', 'pb', 'ga', 'gb']);
    expect(v1.tabs[1].chromeGroupId).toBe('gg');
    expect('pinned' in v1.tabs[1]).toBe(false);
  });

  it('the last pinned tab dropped on the boundary one slot down stays pinned: a put-back changes nothing', () => {
    const before = base();
    expect(reducer(before, within1('p2', 1))).toBe(before);
  });

  it('the first unpinned tab dropped on the boundary stays unpinned: a put-back changes nothing', () => {
    const before = base();
    expect(reducer(before, within1('t1', 2))).toBe(before);
  });

  it('one slot past the boundary unpins the last pinned tab', () => {
    const next = reducer(base(), within1('p2', 2));
    expect(tabIds(windowIn(next, 'S1', 'w1')).slice(0, 3)).toEqual([
      'p1',
      't1',
      'p2',
    ]);
    expect(pins(next, 'S1', 'w1').slice(0, 3)).toEqual([true, false, false]);
  });
});

describe('across windows (moveTabAcrossWindowsInternal)', () => {
  const across = (
    tabId: string,
    toWindowId: string,
    toIndex: number,
    toChromeGroupId?: string
  ) =>
    moveTabAcrossWindowsInternal({
      tabGroupId: 'S1',
      fromWindowId: tabId === 't3' ? 'w2' : 'w1',
      toWindowId,
      tabId,
      toIndex,
      ...(toChromeGroupId === undefined ? {} : { toChromeGroupId }),
    });

  it('a pinned tab dropped on top of a window with no pinned tabs stays pinned (the boundary, R2)', () => {
    const next = reducer(base(), across('p1', 'w2', 0));
    expect(tabIds(windowIn(next, 'S1', 'w2'))).toEqual(['p1', 't3']);
    expect(pins(next, 'S1', 'w2')).toEqual([true, false]);
  });

  it("a pinned tab dropped below another window's unpinned tabs becomes unpinned", () => {
    const next = reducer(base(), across('p1', 'w2', 1));
    expect(tabIds(windowIn(next, 'S1', 'w2'))).toEqual(['t3', 'p1']);
    expect(pins(next, 'S1', 'w2')).toEqual([false, false]);
  });

  it("an unpinned tab dropped among another window's pinned tabs becomes pinned", () => {
    const next = reducer(base(), across('t3', 'w1', 1));
    expect(tabIds(windowIn(next, 'S1', 'w1')).slice(0, 3)).toEqual([
      'p1',
      't3',
      'p2',
    ]);
    expect(pins(next, 'S1', 'w1').slice(0, 4)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("an unpinned tab dispatched at the end of another window's pinned run stays unpinned (the boundary; a collapsed drop lands here)", () => {
    const next = reducer(base(), across('t3', 'w1', 2));
    expect(tabIds(windowIn(next, 'S1', 'w1')).slice(0, 3)).toEqual([
      'p1',
      'p2',
      't3',
    ]);
    expect(pins(next, 'S1', 'w1').slice(0, 3)).toEqual([true, true, false]);
  });

  it("a pinned tab dropped into another window's band on its boundary joins it, unpinned (A6)", () => {
    const next = reducer(
      base(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'S2',
        fromWindowId: 'd1',
        toWindowId: 'd2',
        tabId: 'q1',
        toIndex: 0,
        toChromeGroupId: 'k1',
      })
    );
    const d2 = windowIn(next, 'S2', 'd2');
    expect(tabIds(d2)).toEqual(['q1', 'x1']);
    expect(d2.tabs[0].chromeGroupId).toBe('k1');
    expect('pinned' in d2.tabs[0]).toBe(false);
  });

  it('the window the active tab left forgets it', () => {
    const next = reducer(base(), across('t1', 'w2', 1));
    expect('activeTabId' in windowIn(next, 'S1', 'w1')).toBe(false);
  });

  it('CONTROL: another tab leaving keeps activeTabId', () => {
    const next = reducer(base(), across('t2', 'w2', 1));
    expect(windowIn(next, 'S1', 'w1').activeTabId).toBe('t1');
  });
});

describe('between sessions (moveToSessionInternal)', () => {
  const carriedTab = (tabId: string): Extract<CarriedRef, { kind: 'tab' }> => ({
    kind: 'tab',
    tabGroupId: 'S1',
    windowId: 'w1',
    tabId,
  });

  it('a pinned tab dropped into a band on the boundary joins it, unpinned (A6)', () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: carriedTab('p1'),
        to: {
          tabGroupId: 'S2',
          windowId: 'd2',
          toIndex: 0,
          toChromeGroupId: 'k1',
        },
      })
    );
    const d2 = windowIn(next, 'S2', 'd2');
    expect(tabIds(d2)).toEqual(['p1', 'x1']);
    expect(d2.tabs[0].chromeGroupId).toBe('k1');
    expect('pinned' in d2.tabs[0]).toBe(false);
  });

  it('a pinned tab dropped above the pinned run stays pinned, where it was dropped', () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: carriedTab('p1'),
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
      })
    );
    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      'p1',
      'q1',
      'u1',
      'u2',
    ]);
    expect(pins(next, 'S2', 'd1')).toEqual([true, true, false, false]);
  });

  it('a pinned tab dropped among the unpinned tabs lands there, unpinned', () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: carriedTab('p1'),
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 3 },
      })
    );
    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      'q1',
      'u1',
      'u2',
      'p1',
    ]);
    expect(pins(next, 'S2', 'd1')).toEqual([true, false, false, false]);
  });

  it('an unpinned tab dropped above the pinned tabs lands there, pinned', () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: carriedTab('t2'),
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
      })
    );
    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      't2',
      'q1',
      'u1',
      'u2',
    ]);
    expect(pins(next, 'S2', 'd1')).toEqual([true, true, false, false]);
  });

  it('a pinned tab carried into a new window keeps its pin', () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: carriedTab('p1'),
        to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'last' },
      })
    );
    expect(windowIn(next, 'S2', 'nw').tabs[0].pinned).toBe(true);
  });

  it('a group carried to another session above its pinned run lands right after it (the reducer floor)', () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: {
          kind: 'group',
          tabGroupId: 'S1',
          windowId: 'w1',
          groupId: 'g1',
        },
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
      })
    );
    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      'q1',
      'g1a',
      'g1b',
      'u1',
      'u2',
    ]);
  });

  it("carrying the active tab away clears the source window's activeTabId", () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: carriedTab('t1'),
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 2 },
      })
    );
    expect('activeTabId' in windowIn(next, 'S1', 'w1')).toBe(false);
  });

  // R3. The carried window's active tab id collides with a tab in S2, so it is re-minted.
  it('a carried window whose active tab is re-minted keeps it as its active tab (R3)', () => {
    const target = session('S2', 'Target', T0 - 2_000, [
      win('d1', [tab('t1')]),
    ]);
    const next = reducer(
      base([target, s1()]),
      moveToSessionInternal({
        carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
        to: { tabGroupId: 'S2', toIndex: 1 },
      })
    );
    const carried = windowIn(next, 'S2', 'w1');
    // PREMISE: the id was re-minted.
    expect(carried.tabs[2].tabId).not.toBe('t1');
    expect(carried.tabs[2].url).toBe('https://t1.test/');
    expect(carried.activeTabId).toBe(carried.tabs[2].tabId);
  });

  it('CONTROL: a carried window with no collision keeps its activeTabId as it was', () => {
    const next = reducer(
      base(),
      moveToSessionInternal({
        carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
        to: { tabGroupId: 'S2', toIndex: 1 },
      })
    );
    expect(windowIn(next, 'S2', 'w1').activeTabId).toBe('t1');
  });
});

describe('into a new session (moveToNewSessionInternal)', () => {
  it('a pinned tab keeps its pin', () => {
    const next = reducer(
      base(),
      moveToNewSessionInternal(
        { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'p1' },
        'New session',
        '',
        { tabGroupId: 'S9', newWindowId: 'n1', now: NOW }
      )
    );
    expect(windowIn(next, 'S9', 'n1').tabs[0].pinned).toBe(true);
  });
});

describe('group moves (the reducer floor)', () => {
  it('a group moved in its window above the pinned run lands right after it (what a collapsed window receives)', () => {
    const next = reducer(
      base(),
      moveChromeGroupInternal({
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
        toIndex: 0,
      })
    );
    expect(tabIds(windowIn(next, 'S1', 'w1'))).toEqual([
      'p1',
      'p2',
      'g1a',
      'g1b',
      't1',
      't2',
    ]);
  });

  it("a group carried above another window's pinned tab lands right after it", () => {
    const next = reducer(
      base(),
      moveChromeGroupAcrossWindowsInternal({
        tabGroupId: 'S2',
        fromWindowId: 'd2',
        toWindowId: 'd1',
        groupId: 'k1',
        toIndex: 0,
      })
    );
    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      'q1',
      'x1',
      'u1',
      'u2',
    ]);
  });

  it('carrying the group that holds the active tab to another window clears activeTabId', () => {
    const next = reducer(
      base([s2(), activeIs(s1(), 'g1a')]),
      moveChromeGroupAcrossWindowsInternal({
        tabGroupId: 'S1',
        fromWindowId: 'w1',
        toWindowId: 'w2',
        groupId: 'g1',
        toIndex: 1,
      })
    );
    expect('activeTabId' in windowIn(next, 'S1', 'w1')).toBe(false);
  });
});

describe('adding the current tab', () => {
  it('an unpinned tab goes to the front, after the pinned run (R8)', () => {
    const next = reducer(
      base(),
      addCurrTabToWindowInternal({
        tabGroupId: 'S1',
        windowId: 'w1',
        tabData: tab('n'),
      })
    );
    expect(tabIds(windowIn(next, 'S1', 'w1')).slice(0, 4)).toEqual([
      'p1',
      'p2',
      'n',
      't1',
    ]);
    expect(pins(next, 'S1', 'w1').slice(0, 4)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('a pinned tab goes to the end of the pinned run, pinned (R8)', () => {
    const next = reducer(
      base(),
      addCurrTabToWindowInternal({
        tabGroupId: 'S1',
        windowId: 'w1',
        tabData: pinned('n'),
      })
    );
    expect(tabIds(windowIn(next, 'S1', 'w1')).slice(0, 4)).toEqual([
      'p1',
      'p2',
      'n',
      't1',
    ]);
    expect(pins(next, 'S1', 'w1').slice(0, 4)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('CONTROL: in a window with no pinned tabs, an unpinned tab goes first, as before', () => {
    const next = reducer(
      base(),
      addCurrTabToWindowInternal({
        tabGroupId: 'S1',
        windowId: 'w2',
        tabData: tab('n'),
      })
    );
    expect(tabIds(windowIn(next, 'S1', 'w2'))).toEqual(['n', 't3']);
  });

  it('a pinned tab added to a group is stored unpinned (A6)', () => {
    const next = reducer(
      base(),
      addCurrTabToChromeGroupInternal({
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
        tabData: pinned('n'),
      })
    );
    const w1 = windowIn(next, 'S1', 'w1');
    expect(tabIds(w1).slice(2, 5)).toEqual(['t1', 'n', 'g1a']);
    const added = w1.tabs.find((t) => t.tabId === 'n');
    expect(added?.chromeGroupId).toBe('g1');
    expect(added !== undefined && 'pinned' in added).toBe(false);
  });
});

describe('deleting', () => {
  it('deleting the active tab clears activeTabId', () => {
    const next = reducer(
      base(),
      deleteTabInternal({ tabGroupId: 'S1', windowId: 'w1', tabId: 't1' })
    );
    expect('activeTabId' in windowIn(next, 'S1', 'w1')).toBe(false);
    expect(sessionIn(next, 'S1').contentModified).toBe(NOW);
  });

  it('CONTROL: deleting another tab keeps activeTabId', () => {
    const next = reducer(
      base(),
      deleteTabInternal({ tabGroupId: 'S1', windowId: 'w1', tabId: 't2' })
    );
    expect(windowIn(next, 'S1', 'w1').activeTabId).toBe('t1');
  });

  it('deleting the group that holds the active tab clears activeTabId', () => {
    const next = reducer(
      base([s2(), activeIs(s1(), 'g1a')]),
      deleteChromeTabGroupInternal({
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
      })
    );
    expect('activeTabId' in windowIn(next, 'S1', 'w1')).toBe(false);
  });

  it('⌘Z brings back the deleted active tab and its activeTabId', () => {
    const { store } = makeTestStore();
    store.dispatch(saveToTabContainerInternal(s1()));
    store.dispatch(
      deleteTabInternal({ tabGroupId: 'S1', windowId: 'w1', tabId: 't1' })
    );
    const state = () => store.getState().tabContainerDataState;
    expect('activeTabId' in windowIn(state(), 'S1', 'w1')).toBe(false);
    store.dispatch(undo());
    expect(windowIn(state(), 'S1', 'w1').activeTabId).toBe('t1');
  });

  it('⌘Z takes back a drop that pinned a tab', () => {
    const { store } = makeTestStore();
    store.dispatch(saveToTabContainerInternal(s1()));
    store.dispatch(within1('t2', 0));
    const state = () => store.getState().tabContainerDataState;
    expect(windowIn(state(), 'S1', 'w1').tabs[0].pinned).toBe(true);
    store.dispatch(undo());
    expect(tabIds(windowIn(state(), 'S1', 'w1'))[0]).toBe('p1');
    expect(
      windowIn(state(), 'S1', 'w1').tabs.find((t) => t.tabId === 't2')?.pinned
    ).toBeUndefined();
  });
});
