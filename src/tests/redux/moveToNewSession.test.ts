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

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  moveToNewSessionInternal,
  replaceState,
  type CarriedRef,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import {
  beginDragHold,
  endDragHold,
  whenDragReleases,
} from '../../redux/dragHold';
import { moveToNewSession } from '../../redux/moveToNewSession';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  T0,
  container,
  session,
  sessionIds,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-394 P3 Task 14. The thunk a drop on the save row calls: through
// dropOnTop like every drop, no Moved toast, the emptied toast when the
// source is gone, and the new session shown.

type Store = ReturnType<typeof makeTestStore>['store'];

const T1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};

const T3_EMPTIES_S1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w2',
  tabId: 't3',
};

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

const EMPTIED = (title: string) => ({
  text: TOAST_MESSAGES.SESSION_EMPTIED_REMOVED,
  params: { title },
  show: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  location.search = '';
});

afterEach(() => {
  endDragHold();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('moveToNewSession: the result', () => {
  it('moves the item into a new session on top, shows it, and returns true', () => {
    const { store } = ready();

    const moved = store.dispatch(moveToNewSession(T1, 'Fallback'));

    expect(moved).toBe(true);
    const newId = sessionIds(data(store))[0];
    expect(sessionIds(data(store))).toEqual([newId, 'S1', 'S3', 'S2']);
    expect(data(store).selectedTabGroupId).toBe(newId);
    expect(tabIds(sessionIn(data(store), newId).windows[0])).toEqual(['t1']);
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).not.toContain('t1');
  });

  it('the typed name reaches the new session', () => {
    const { store } = ready();

    store.dispatch(moveToNewSession(T1, 'Fallback', '  Trip  '));

    expect(sessionIn(data(store), sessionIds(data(store))[0]).title).toBe(
      'Trip'
    );
  });
});

describe('moveToNewSession: the toasts (4A)', () => {
  it('sends none for a drop that leaves its source', () => {
    const { store } = ready();
    store.dispatch(moveToNewSession(T1, 'Fallback'));

    expect(toasts(store)).toEqual([]);
  });

  it('a window emptied but not its session sends none', () => {
    const { store } = ready();
    store.dispatch(moveToNewSession(T3_EMPTIES_S1, 'Fallback'));

    expect(sessionIds(data(store))).toHaveLength(4);
    expect(toasts(store)).toEqual([]);
  });

  it('sends only the emptied toast, named for the source, when the source is gone', () => {
    const { store } = ready(
      container([
        session('S1', 'Source', T0 - 3_600_000, [win('w2', [tab('t3')])]),
      ])
    );
    store.dispatch(moveToNewSession(T3_EMPTIES_S1, 'Fallback'));

    expect(sessionIds(data(store))).toHaveLength(1);
    expect(toasts(store)).toEqual([EMPTIED('Source')]);
  });
});

// The drop goes through dropOnTop: a change that arrived while the item was
// carried is applied first.
describe('moveToNewSession at the drop: a change that arrived while carried', () => {
  const holdWithChange = (
    store: Store,
    edit: (next: TabMasterContainer) => void
  ) => {
    const next = structuredClone(data(store));
    edit(next);
    beginDragHold();
    whenDragReleases(() => store.dispatch(replaceState(next)));
  };

  const drop = (store: Store, carried: CarriedRef) => {
    const moved = store.dispatch(moveToNewSession(carried, 'Fallback'));
    endDragHold();
    return moved;
  };

  it('the carried tab was deleted: false, no session added, no toast', () => {
    const { store, seen } = ready();
    holdWithChange(store, (next) => {
      const w1 = windowIn(next, 'S1', 'w1');
      w1.tabs = w1.tabs.filter((t) => t.tabId !== 't1');
    });

    expect(drop(store, T1)).toBe(false);

    expect(sessionIds(data(store))).toEqual(['S3', 'S2', 'S1']);
    expect(seen).not.toContain(moveToNewSessionInternal.type);
    expect(toasts(store)).toEqual([]);
  });

  it('the source session was deleted: false, nothing added', () => {
    const { store } = ready();
    holdWithChange(store, (next) => {
      next.tabGroups = next.tabGroups.filter((g) => g.tabGroupId !== 'S1');
    });

    expect(drop(store, T1)).toBe(false);

    expect(sessionIds(data(store))).toEqual(['S3', 'S2']);
  });

  it('a held change that failed to apply abandons the drop', () => {
    const { store, seen } = ready();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    beginDragHold();
    whenDragReleases(() => {
      throw new Error('the held apply failed');
    });

    expect(drop(store, T1)).toBe(false);

    expect(seen).not.toContain(moveToNewSessionInternal.type);
    expect(sessionIds(data(store))).toEqual(['S3', 'S2', 'S1']);
  });

  it('S1 was renamed: both the rename and the move land', () => {
    const { store } = ready();
    holdWithChange(store, (next) => {
      sessionIn(next, 'S1').title = 'Renamed';
    });

    expect(drop(store, T1)).toBe(true);

    expect(sessionIn(data(store), 'S1').title).toBe('Renamed');
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).not.toContain('t1');
    expect(sessionIds(data(store))).toHaveLength(4);
  });
});

describe('moveToNewSession: showing the new session', () => {
  it('folded in the tab view, it peeks first so the session can show', () => {
    location.search = '?view=tab';
    const { store } = ready();
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);

    store.dispatch(moveToNewSession(T1, 'Fallback'));

    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
  });

  it('in the popup it does not peek', () => {
    const { store } = ready();

    store.dispatch(moveToNewSession(T1, 'Fallback'));

    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
  });
});
