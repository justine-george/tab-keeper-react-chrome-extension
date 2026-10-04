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

import reducer, {
  moveToSessionInternal,
  replaceState,
  type CarriedRef,
  type SessionMove,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import { endDragHold } from '../../redux/dragHold';
import { moveToSession } from '../../redux/moveToSession';
import { dropCarriedGroup, dropCarriedTab } from '../../redux/dropCarried';
import { NEW_FIRST_WINDOW } from '../../components/home/rightpane/newWindowTarget';
import { makeTestStore } from '../setup/makeStore';
import {
  T0,
  container,
  group,
  s2,
  s3,
  session,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIds,
} from '../fixtures/sessionMoveFixture';

// KAN-350 final review, finding 1. A new window made in the item's OWN
// session, from a window that holds nothing but that item and is already the
// session's first window, would rebuild that same window: a new id, no
// title in place of its own, the session stamped and sorted to
// the top. The drop changes nothing the user can see, so it must change
// nothing at all -- and say so, so the carry ends as a cancel.
//
// S9: `only` holds the lone tab, then w2. G9: `gw` holds the group gg and
// nothing else, then w2.

const NS = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const HOUR = 3_600_000;

const s9 = (): tabContainerData => {
  const s = session('S9', 'Nine', T0 - 4 * HOUR, [
    win('only', [tab('lone')]),
    win('w2', [tab('x1'), tab('x2')]),
  ]);
  // A title of its own, which a rebuilt window would lose.
  s.windows[0].title = 'Kept';
  return s;
};

const g9 = (): tabContainerData =>
  session('G9', 'Grouped', T0 - 5 * HOUR, [
    win('gw', [tab('gm1', 'gg'), tab('gm2', 'gg')], [group('gg')]),
    win('w2', [tab('x1')]),
  ]);

const LONE: Extract<CarriedRef, { kind: 'tab' }> = {
  kind: 'tab',
  tabGroupId: 'S9',
  windowId: 'only',
  tabId: 'lone',
};

const WHOLE_GROUP: Extract<CarriedRef, { kind: 'group' }> = {
  kind: 'group',
  tabGroupId: 'G9',
  windowId: 'gw',
  groupId: 'gg',
};

const seeded = (c: TabMasterContainer): TabMasterContainer =>
  reducer(undefined, replaceState(c));

const moved = (state: TabMasterContainer, move: SessionMove) =>
  reducer(state, moveToSessionInternal(move, NS));

type Store = ReturnType<typeof makeTestStore>['store'];

const ready = (c: TabMasterContainer) => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made.store;
};

const data = (store: Store) => store.getState().tabContainerDataState;
const toasts = (store: Store) => store.getState().globalState.toasts;

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

describe('a new window in its own session that would change nothing', () => {
  it('a lone tab already alone in the first window: the very same state, nothing saved', () => {
    const before = seeded(container([s9(), s3()]));
    localStorage.clear();

    expect(
      moved(before, {
        carried: LONE,
        to: { tabGroupId: 'S9', newWindowId: 'nw', at: 'first' },
      })
    ).toBe(before);
    expect(localStorage.getItem('tabContainerData')).toBeNull();
  });

  it('a group that is its first window’s whole content: the very same state, nothing saved', () => {
    const before = seeded(container([g9(), s3()]));
    localStorage.clear();

    expect(
      moved(before, {
        carried: WHOLE_GROUP,
        to: { tabGroupId: 'G9', newWindowId: 'nw', at: 'first' },
      })
    ).toBe(before);
    expect(localStorage.getItem('tabContainerData')).toBeNull();
  });

  it('CONTROL: the same lone tab in a window that is NOT first is a move: it becomes first', () => {
    const s = s9();
    s.windows.reverse();
    const next = moved(seeded(container([s, s3()])), {
      carried: LONE,
      to: { tabGroupId: 'S9', newWindowId: 'nw', at: 'first' },
    });

    expect(windowIds(sessionIn(next, 'S9'))).toEqual(['nw', 'w2']);
    expect(tabIds(sessionIn(next, 'S9').windows[0])).toEqual(['lone']);
  });

  it('CONTROL: a lone tab in a group is a move even when first: it leaves its group', () => {
    const s = session('S9', 'Nine', T0 - 4 * HOUR, [
      win('only', [tab('lone', 'gg')], [group('gg')]),
      win('w2', [tab('x1')]),
    ]);
    const next = moved(seeded(container([s, s3()])), {
      carried: LONE,
      to: { tabGroupId: 'S9', newWindowId: 'nw', at: 'first' },
    });

    const first = sessionIn(next, 'S9').windows[0];
    expect(first.windowId).toBe('nw');
    expect(first.tabs).toEqual([tab('lone')]);
    expect(first.chromeTabGroups).toBeUndefined();
  });

  it('CONTROL: a group sharing its first window with a loose tab is a move', () => {
    const s = g9();
    s.windows[0].tabs.push(tab('loose'));
    s.windows[0].tabCount = 3;
    s.tabCount = 4;
    const next = moved(seeded(container([s, s3()])), {
      carried: WHOLE_GROUP,
      to: { tabGroupId: 'G9', newWindowId: 'nw', at: 'first' },
    });

    expect(windowIds(sessionIn(next, 'G9'))).toEqual(['nw', 'gw', 'w2']);
    expect(tabIds(sessionIn(next, 'G9').windows[1])).toEqual(['loose']);
  });
});

// The same rule for a new LAST window: it is a no-op where the item's window
// is already last, and a real move anywhere else (a first window made last).
describe('a new LAST window in its own session that would change nothing', () => {
  it('a lone tab already alone in the last window: the very same state, nothing saved', () => {
    const s = s9();
    s.windows.reverse();
    const before = seeded(container([s, s3()]));
    localStorage.clear();

    expect(
      moved(before, {
        carried: LONE,
        to: { tabGroupId: 'S9', newWindowId: 'nw', at: 'last' },
      })
    ).toBe(before);
    expect(localStorage.getItem('tabContainerData')).toBeNull();
  });

  it('CONTROL: the same lone tab in the FIRST window is a move: it becomes last', () => {
    const next = moved(seeded(container([s9(), s3()])), {
      carried: LONE,
      to: { tabGroupId: 'S9', newWindowId: 'nw', at: 'last' },
    });

    expect(windowIds(sessionIn(next, 'S9'))).toEqual(['w2', 'nw']);
    expect(tabIds(sessionIn(next, 'S9').windows[1])).toEqual(['lone']);
  });

  it('CONTROL: a group that is its first window’s whole content is a move to last', () => {
    const next = moved(seeded(container([g9(), s3()])), {
      carried: WHOLE_GROUP,
      to: { tabGroupId: 'G9', newWindowId: 'nw', at: 'last' },
    });

    expect(windowIds(sessionIn(next, 'G9'))).toEqual(['w2', 'nw']);
  });
});

// Every route that makes a new window reaches the same reducer, so each one
// declines, and says it moved nothing: the carry then ends as a cancel.
describe('the routes to a new window decline it too', () => {
  it('the header’s New window target in the source (Q2 A), for a lone tab', () => {
    const store = ready(container([s9(), s3()], 'S9'));
    const before = data(store);

    const result = store.dispatch(
      dropCarriedTab(LONE, {
        tabGroupId: 'S9',
        toWindowId: NEW_FIRST_WINDOW,
        toIndex: 0,
      })
    );

    expect(result).toBe(false);
    expect(data(store)).toBe(before);
    expect(toasts(store)).toEqual([]);
    expect(store.getState().undoRedo.past).toHaveLength(0);
  });

  it('the header’s New window target in the source (Q2 A), for a whole-window group', () => {
    const store = ready(container([g9(), s3()], 'G9'));
    const before = data(store);

    const result = store.dispatch(
      dropCarriedGroup(WHOLE_GROUP, {
        tabGroupId: 'G9',
        toWindowId: NEW_FIRST_WINDOW,
        toIndex: 0,
      })
    );

    expect(result).toBe(false);
    expect(data(store)).toBe(before);
  });
});

// Finding 6. moveToSession says whether the item moved, and a carry receiver
// reports that as committed or cancelled. Each `false` path, and a `true`.
describe('moveToSession says whether anything moved', () => {
  it('a real move: true', () => {
    const store = ready(container([s9(), s2(), s3()]));
    const result = store.dispatch(
      moveToSession({
        move: {
          carried: LONE,
          to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
        },
        announceMoved: false,
      })
    );

    expect(result).toBe(true);
    expect(tabIds(sessionIn(data(store), 'S2').windows[1])).toEqual([
      'lone',
      'u4',
    ]);
  });

  it('a destination session that has vanished: false', () => {
    const store = ready(container([s9(), s3()]));
    const before = data(store);
    const result = store.dispatch(
      moveToSession({
        move: {
          carried: LONE,
          to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
        },
        announceMoved: true,
      })
    );

    expect(result).toBe(false);
    expect(data(store)).toBe(before);
  });

  it('a move the reducer declines: false', () => {
    const store = ready(container([s9(), s3()]));
    const before = data(store);
    const result = store.dispatch(
      moveToSession({
        move: {
          carried: LONE,
          to: { tabGroupId: 'S9', newWindowId: 'nw', at: 'first' },
        },
        announceMoved: true,
      })
    );

    expect(result).toBe(false);
    expect(data(store)).toBe(before);
    expect(toasts(store)).toEqual([]);
  });

  it('a same-session move to an exact spot, which the reducer is not for: false', () => {
    const store = ready(container([s9(), s3()]));
    const result = store.dispatch(
      moveToSession({
        move: {
          carried: LONE,
          to: { tabGroupId: 'S9', windowId: 'w2', toIndex: 0 },
        },
        announceMoved: true,
      })
    );

    expect(result).toBe(false);
  });
});
