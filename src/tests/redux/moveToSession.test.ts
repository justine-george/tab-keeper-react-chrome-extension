import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
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

import { makeTestStore } from '../setup/makeStore';
import {
  moveToSessionInternal,
  replaceState,
  type SessionMove,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  selectReopenOfferForKey,
  setIsNotDirty,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { redo, resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import {
  beginDragHold,
  endDragHold,
  whenDragReleases,
} from '../../redux/dragHold';
import { moveToSession } from '../../redux/moveToSession';
import { intoNewWindow, sessionMoveDrop } from '../../redux/dropSpecs';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  T0,
  container,
  s1,
  s2,
  s3,
  session,
  sessionIds,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-350 Task 2. The thunk the drag calls, through dropOnTop like every
// drop, and the toasts it sends; the undo, redo and sync it takes part in.

type Store = ReturnType<typeof makeTestStore>['store'];

// A source with one window of one tab: moving that tab empties it.
const lonely = (): tabContainerData =>
  session('S1', 'Source', T0 - 3 * 3_600_000, [win('w2', [tab('t3')])]);

const ready = (c: TabMasterContainer = container()) => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made;
};

const data = (store: Store) => store.getState().tabContainerDataState;

const toasts = (store: Store) =>
  store.getState().globalState.toasts.map((t) => ({
    text: t.text,
    params: t.params,
    show: t.show,
  }));

const T1_TO_D1: SessionMove = {
  carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
  to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 },
};

const T3_EMPTIES_S1: SessionMove = {
  carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
  to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
};

const MOVED = (title: string, show: { tabGroupId: string } | null) => ({
  text: TOAST_MESSAGES.MOVED_TO_SESSION,
  params: { title },
  show,
});

const EMPTIED = (title: string) => ({
  text: TOAST_MESSAGES.SESSION_EMPTIED_REMOVED,
  params: { title },
  show: null,
});

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

describe('moveToSession: the toasts (S5 A, Toasts, Show rule)', () => {
  it('announces the move with Show when the target is not on screen', () => {
    const { store } = ready();
    store.dispatch(moveToSession({ move: T1_TO_D1, announceMoved: true }));

    expect(tabIds(windowIn(data(store), 'S2', 'd1'))).toEqual([
      'u1',
      't1',
      'u2',
      'u3',
    ]);
    expect(toasts(store)).toEqual([MOVED('Target', { tabGroupId: 'S2' })]);
  });

  it('announces it without Show when the target is already on screen', () => {
    const { store } = ready(container(undefined, 'S2'));
    store.dispatch(moveToSession({ move: T1_TO_D1, announceMoved: true }));

    expect(toasts(store)).toEqual([MOVED('Target', null)]);
  });

  it('sends no Moved toast when not asked to (a drop into the opened session)', () => {
    const { store } = ready();
    store.dispatch(moveToSession({ move: T1_TO_D1, announceMoved: false }));

    // The premise: it moved.
    expect(tabIds(windowIn(data(store), 'S2', 'd1'))).toContain('t1');
    expect(toasts(store)).toEqual([]);
  });

  it('an emptied source adds its own toast, below the Moved one', () => {
    const { store } = ready(container([s3(), s2(), lonely()]));
    store.dispatch(moveToSession({ move: T3_EMPTIES_S1, announceMoved: true }));

    expect(sessionIds(data(store))).toEqual(['S2', 'S3']);
    expect(toasts(store)).toEqual([
      MOVED('Target', { tabGroupId: 'S2' }),
      EMPTIED('Source'),
    ]);
  });

  it('an emptied source that was on screen: the target is selected, so no Show (Q4 A)', () => {
    const { store } = ready(container([s3(), s2(), lonely()], 'S1'));
    store.dispatch(moveToSession({ move: T3_EMPTIES_S1, announceMoved: true }));

    expect(data(store).selectedTabGroupId).toBe('S2');
    expect(toasts(store)).toEqual([MOVED('Target', null), EMPTIED('Source')]);
  });

  it('the emptied toast comes without the Moved one when that was not asked for', () => {
    const { store } = ready(container([s3(), s2(), lonely()]));
    store.dispatch(
      moveToSession({ move: T3_EMPTIES_S1, announceMoved: false })
    );

    expect(toasts(store)).toEqual([EMPTIED('Source')]);
  });

  it('the Moved toast lasts 8s and the emptied one 5s', () => {
    const { store } = ready(container([s3(), s2(), lonely()]));
    store.dispatch(moveToSession({ move: T3_EMPTIES_S1, announceMoved: true }));

    vi.advanceTimersByTime(4_999);
    expect(toasts(store)).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(toasts(store)).toEqual([MOVED('Target', { tabGroupId: 'S2' })]);
    vi.advanceTimersByTime(2_999);
    expect(toasts(store)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts(store)).toEqual([]);
  });
});

// KAN-349 Q1 C′. Each toast announces a saved change the user just made, so
// each takes ⌘Z from a Reopen offer showing above it.
describe('moveToSession: both toasts take ⌘Z from a Reopen offer (C′)', () => {
  const withOffer = async (c: TabMasterContainer) => {
    const made = ready(c);
    await made.store.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.TAB_CLOSED,
        duration: 8000,
        reopenOfferId: 7,
      })
    );
    expect(selectReopenOfferForKey(made.store.getState())).toBe(7);
    return made.store;
  };

  it('the Moved toast', async () => {
    const store = await withOffer(container());
    store.dispatch(moveToSession({ move: T1_TO_D1, announceMoved: true }));

    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  it('the emptied toast', async () => {
    const store = await withOffer(container([s3(), s2(), lonely()]));
    store.dispatch(
      moveToSession({ move: T3_EMPTIES_S1, announceMoved: false })
    );

    expect(toasts(store).map((t) => t.text)).toContain(
      TOAST_MESSAGES.SESSION_EMPTIED_REMOVED
    );
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });
});

describe('moveToSession: one step to undo, and synced', () => {
  it('marks sync dirty and is one undo step', () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    store.dispatch(moveToSession({ move: T1_TO_D1, announceMoved: true }));

    expect(store.getState().globalState.isDirty).toBe(true);
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
  });

  // S4 B: ⌘Z restores both sessions in one step. "Exactly": everything but
  // lastModified, which the undo stamps past the move so the next merge
  // prefers the restored copies over the cloud's moved ones.
  it('⌘Z restores both sessions exactly and withdraws the tombstone; redo re-applies', () => {
    const { store } = ready(container([s3(), s2(), lonely()], 'S1'));
    const before = structuredClone(data(store));

    vi.setSystemTime(T0 + 1_000);
    store.dispatch(moveToSession({ move: T3_EMPTIES_S1, announceMoved: true }));
    expect(sessionIds(data(store))).toEqual(['S2', 'S3']);
    expect(data(store).deletedTabGroups).toEqual([
      { tabGroupId: 'S1', deletedAt: T0 + 1_000 },
    ]);

    vi.setSystemTime(T0 + 2_000);
    store.dispatch(undo());

    const restored = data(store);
    const withoutStamp = (g: tabContainerData) => ({
      ...g,
      lastModified: undefined,
    });
    expect(restored.tabGroups.map(withoutStamp)).toEqual(
      before.tabGroups.map(withoutStamp)
    );
    expect(restored.selectedTabGroupId).toBe('S1');
    // No live tombstone for the restored source, and it outranks the one the
    // cloud may hold.
    expect(restored.deletedTabGroups ?? []).toEqual([]);
    expect(sessionIn(restored, 'S1').lastModified).toBeGreaterThan(T0 + 1_000);
    // The target outranks its moved copy, which the cloud may hold too.
    expect(sessionIn(restored, 'S2').lastModified).toBeGreaterThan(
      T0 + 1_000 + 1
    );

    vi.setSystemTime(T0 + 3_000);
    store.dispatch(redo());

    const redone = data(store);
    expect(sessionIds(redone)).toEqual(['S2', 'S3']);
    expect(tabIds(windowIn(redone, 'S2', 'd2'))).toEqual(['t3', 'u4']);
    const grave = (redone.deletedTabGroups ?? []).find(
      (g) => g.tabGroupId === 'S1'
    );
    // Live again: stamped past the restored copy, or the merge would keep it.
    expect(grave?.deletedAt).toBeGreaterThan(
      sessionIn(restored, 'S1').lastModified ?? Infinity
    );
  });

  // S4 B for a new LAST window, own session and another: one ⌘Z puts both
  // sessions back exactly, and ⌘⇧Z lands the window last again.
  it.each([
    ['another session', 'S2', ['d1', 'd2', 'NEW']],
    ['its own session', 'S1', ['w1', 'w2', 'NEW']],
  ])(
    '⌘Z undoes a move into a new last window of %s in one step',
    (_, into, order) => {
      const { store } = ready();
      const before = structuredClone(data(store));
      const past = store.getState().undoRedo.past.length;

      vi.setSystemTime(T0 + 1_000);
      store.dispatch(
        moveToSession({
          move: {
            carried: {
              kind: 'group',
              tabGroupId: 'S1',
              windowId: 'w1',
              groupId: 'g1',
            },
            to: { tabGroupId: into, newWindowId: 'NEW', at: 'last' },
          },
          announceMoved: true,
        })
      );
      expect(store.getState().undoRedo.past.length).toBe(past + 1);
      expect(
        sessionIn(data(store), into).windows.map((w) => w.windowId)
      ).toEqual(order);

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const withoutStamp = (g: tabContainerData) => ({
        ...g,
        lastModified: undefined,
      });
      expect(data(store).tabGroups.map(withoutStamp)).toEqual(
        before.tabGroups.map(withoutStamp)
      );

      vi.setSystemTime(T0 + 3_000);
      store.dispatch(redo());
      expect(
        sessionIn(data(store), into).windows.map((w) => w.windowId)
      ).toEqual(order);
    }
  );

  it('a same-session move to an exact spot is not this thunk’s: nothing moves, nothing toasts', () => {
    const { store, seen } = ready();
    const before = data(store);
    const result = store.dispatch(
      moveToSession({
        move: {
          carried: {
            kind: 'tab',
            tabGroupId: 'S1',
            windowId: 'w1',
            tabId: 't1',
          },
          to: { tabGroupId: 'S1', windowId: 'w2', toIndex: 0 },
        },
        announceMoved: true,
      })
    );

    // The premise: the reducer was asked, and declined.
    expect(result).toBe(false);
    expect(seen).toContain(moveToSessionInternal.type);
    expect(data(store)).toBe(before);
    expect(toasts(store)).toEqual([]);
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(store.getState().undoRedo.past.length).toBe(0);
  });
});

// Review Focus 1. The drop goes through dropOnTop: a change that arrived while
// the item was carried is applied first. One that removed the source item or
// the destination leaves the removal standing: nothing moves, and nothing is
// announced.
describe('moveToSession at the drop: a change that arrived while carried', () => {
  // Hold, and queue a change this page did not make, applied at the drop.
  const holdWithChange = (
    store: Store,
    edit: (next: TabMasterContainer) => void
  ) => {
    const next = structuredClone(data(store));
    edit(next);
    beginDragHold();
    whenDragReleases(() => store.dispatch(replaceState(next)));
  };

  const drop = (store: Store, move: SessionMove) => {
    store.dispatch(moveToSession({ move, announceMoved: true }));
    endDragHold();
  };

  it('the destination session was deleted: the tab stays, no toast', () => {
    const { store, seen } = ready();
    holdWithChange(store, (next) => {
      next.tabGroups = next.tabGroups.filter((g) => g.tabGroupId !== 'S2');
    });

    drop(store, T1_TO_D1);

    expect(sessionIds(data(store))).toEqual(['S3', 'S1']);
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).toContain('t1');
    expect(seen).not.toContain(moveToSessionInternal.type);
    expect(toasts(store)).toEqual([]);
  });

  it('the destination window was deleted: the tab stays, no toast', () => {
    const { store, seen } = ready();
    holdWithChange(store, (next) => {
      const target = sessionIn(next, 'S2');
      target.windows = target.windows.filter((w) => w.windowId !== 'd1');
    });

    drop(store, T1_TO_D1);

    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).toContain('t1');
    expect(seen).not.toContain(moveToSessionInternal.type);
    expect(toasts(store)).toEqual([]);
  });

  it('the carried tab was deleted: nothing moves, no toast', () => {
    const { store, seen } = ready();
    holdWithChange(store, (next) => {
      const w1 = windowIn(next, 'S1', 'w1');
      w1.tabs = w1.tabs.filter((t) => t.tabId !== 't1');
    });

    drop(store, T1_TO_D1);

    expect(tabIds(windowIn(data(store), 'S2', 'd1'))).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(seen).not.toContain(moveToSessionInternal.type);
    expect(toasts(store)).toEqual([]);
  });

  it('a held change that failed to apply abandons the drop: no toast', () => {
    const { store, seen } = ready();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    beginDragHold();
    whenDragReleases(() => {
      throw new Error('the held apply failed');
    });

    drop(store, T1_TO_D1);

    expect(seen).not.toContain(moveToSessionInternal.type);
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).toContain('t1');
    expect(toasts(store)).toEqual([]);
  });

  // CONTROL: the drop still lands and still announces when the change that
  // arrived touched neither end -- and re-aimed, beside the neighbour it was
  // aimed at: u1 above it, though a tab arrived at the top of d1.
  it('CONTROL: an unrelated change arrived: the tab lands beside its neighbour and is announced', () => {
    const { store } = ready();
    holdWithChange(store, (next) => {
      const d1 = windowIn(next, 'S2', 'd1');
      d1.tabs.unshift(tab('n0'));
      d1.tabCount += 1;
    });

    drop(store, T1_TO_D1);

    expect(tabIds(windowIn(data(store), 'S2', 'd1'))).toEqual([
      'n0',
      'u1',
      't1',
      'u2',
      'u3',
    ]);
    expect(toasts(store)).toEqual([MOVED('Target', { tabGroupId: 'S2' })]);
  });

  it('a session that is gone before the drag ends moves nothing and toasts nothing', () => {
    const { store } = ready(container([s3(), s2()]));
    const before = data(store);
    store.dispatch(moveToSession({ move: T1_TO_D1, announceMoved: true }));

    expect(data(store)).toBe(before);
    expect(toasts(store)).toEqual([]);
  });
});

// The list each move's toIndex counts, read from a state, and whether the
// carried item is still in its source: what dropOnTop re-aims with.
describe('sessionMoveDrop', () => {
  const state = () => container();

  it('a tab to a spot: the destination window tabs, and the tab in its source window', () => {
    const drop = sessionMoveDrop(T1_TO_D1);
    expect(drop.rowId).toBe('t1');
    expect(drop.toIndex).toBe(1);
    expect(drop.targetIds(state())).toEqual(['u1', 'u2', 'u3']);
    expect(drop.rowExists(state())).toBe(true);

    const gone = state();
    const w1 = windowIn(gone, 'S1', 'w1');
    w1.tabs = w1.tabs.filter((t) => t.tabId !== 't1');
    expect(drop.rowExists(gone)).toBe(false);
  });

  it('a tab joining a band that is gone has nowhere to land', () => {
    const drop = sessionMoveDrop({
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: {
        tabGroupId: 'S2',
        windowId: 'd1',
        toIndex: 1,
        toChromeGroupId: 'h1',
      },
    });
    expect(drop.targetIds(state())).toEqual(['u1', 'u2', 'u3']);

    const gone = state();
    windowIn(gone, 'S2', 'd1').chromeTabGroups = [];
    expect(drop.targetIds(gone)).toBeNull();
  });

  it('a group to a spot: the destination window items, and the group among its source items', () => {
    const drop = sessionMoveDrop({
      carried: {
        kind: 'group',
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
      },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 },
    });
    expect(drop.rowId).toBe('group:g1');
    expect(drop.targetIds(state())).toEqual(['tab:u1', 'group:h1']);
    expect(drop.rowExists(state())).toBe(true);

    const gone = state();
    windowIn(gone, 'S1', 'w1').chromeTabGroups = [];
    expect(drop.rowExists(gone)).toBe(false);
  });

  it('a window: the destination session windows, and the window in its source session', () => {
    const drop = sessionMoveDrop({
      carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
      to: { tabGroupId: 'S2', toIndex: 1 },
    });
    expect(drop.rowId).toBe('w1');
    expect(drop.targetIds(state())).toEqual(['d1', 'd2']);
    expect(drop.rowExists(state())).toBe(true);

    const gone = state();
    sessionIn(gone, 'S1').windows = [];
    expect(drop.rowExists(gone)).toBe(false);
  });

  it('into a new window: the destination session windows, at the top', () => {
    const drop = sessionMoveDrop({
      carried: {
        kind: 'group',
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
      },
      to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'first' },
    });
    expect(drop.targetIds(state())).toEqual(['d1', 'd2']);
    expect(drop.toIndex).toBe(0);
  });

  it('into a new LAST window: the same list, aimed past its end; a first one is aimed at 0', () => {
    const carried = {
      kind: 'tab',
      tabGroupId: 'S1',
      windowId: 'w1',
      tabId: 't1',
    } as const;
    const last = sessionMoveDrop({
      carried,
      to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'last' },
    });
    expect(last.targetIds(state())).toEqual(['d1', 'd2']);
    expect(last.toIndex).toBeGreaterThanOrEqual(2);
    expect(
      sessionMoveDrop({
        carried,
        to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'first' },
      }).toIndex
    ).toBe(0);
  });

  it('a destination session that is gone has nowhere to land', () => {
    const gone = container([s3(), s1()]);
    expect(sessionMoveDrop(T1_TO_D1).targetIds(gone)).toBeNull();
    expect(
      sessionMoveDrop({
        carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
        to: { tabGroupId: 'S2', toIndex: 0 },
      }).targetIds(gone)
    ).toBeNull();
    expect(
      sessionMoveDrop({
        carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
        to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'first' },
      }).targetIds(gone)
    ).toBeNull();
  });

  it('the move carries the re-aimed index to an exact spot, and leaves a new window alone', () => {
    const spot = sessionMoveDrop(T1_TO_D1).move(3);
    expect(moveToSessionInternal.match(spot) && spot.payload.move).toEqual({
      ...T1_TO_D1,
      to: { ...T1_TO_D1.to, toIndex: 3 },
    });

    const intoNew: SessionMove = {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', newWindowId: 'nw', at: 'first' },
    };
    const fresh = sessionMoveDrop(intoNew).move(2);
    expect(moveToSessionInternal.match(fresh) && fresh.payload.move).toEqual(
      intoNew
    );
  });
});

describe('intoNewWindow', () => {
  it('carries where the window goes', () => {
    expect(intoNewWindow('S2', 'first').at).toBe('first');
    expect(intoNewWindow('S2', 'last').at).toBe('last');
  });

  it('names the session and mints a new window id each time', () => {
    const a = intoNewWindow('S2', 'first');
    const b = intoNewWindow('S2', 'first');
    expect(a.tabGroupId).toBe('S2');
    expect(a.newWindowId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(b.newWindowId).not.toBe(a.newWindowId);
  });
});
