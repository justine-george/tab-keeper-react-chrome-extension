import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import { nextActionNumber } from '../../redux/actionOrder';
import { keepOpenedStep } from '../../redux/undoHistory';
import {
  liveStepDropped,
  liveStepRedone,
  liveStepUndone,
  pushLiveStep,
  resetHistory,
  selectLiveStepOnTop,
  selectNextStep,
  set,
  setPresentStartup,
  setPresentWithoutHistory,
  undo,
  type LiveStep,
  type UndoableStates,
} from '../../redux/slices/undoRedoSlice';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';
import {
  isOpenedCopy,
  renameIds,
  type OpenedCopy,
} from '../../utils/functions/openedCopy';
import { STACK_LEVEL } from '../../utils/constants/common';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer } from '../fixtures/sessionFixture';

const place = {
  windowId: 1,
  index: 0,
  groupId: -1,
  group: null,
  pinned: false,
};

function drop(tabId: number): OpenNowDrop {
  return {
    kind: 'tab',
    moved: [
      {
        tabId,
        before: place,
        after: { ...place, index: 1 },
      },
    ],
  };
}

function liveStep(id: number): LiveStep {
  return { id, drop: drop(id) };
}

function saved(stamp: number): UndoableStates {
  return {
    tabContainerDataState: { ...buildContainer(), lastModified: stamp },
    addedTabGroupIds: [],
  };
}

function setup() {
  const { store } = makeTestStore();
  const history = () => store.getState().undoRedo;
  return { store, history };
}

describe('live steps in the undo history (KAN-744)', () => {
  it('saved and live steps keep one order', () => {
    const { store, history } = setup();
    const l2 = liveStep(2);
    store.dispatch(set(saved(1)));
    store.dispatch(pushLiveStep(l2));
    store.dispatch(set(saved(3)));
    expect(selectNextStep(store.getState(), 'undo')).toBe('saved');

    store.dispatch(undo());
    expect(selectNextStep(store.getState(), 'undo')).toBe('live');

    const l2Again = { ...l2 };
    store.dispatch(liveStepUndone(l2Again));
    expect(selectNextStep(store.getState(), 'undo')).toBe('saved');
    expect(history().future[0].liveStep).toEqual(l2Again);
    expect(selectNextStep(store.getState(), 'redo')).toBe('live');
  });

  it('there is nothing to undo or redo on a fresh history', () => {
    const { store } = setup();
    expect(selectNextStep(store.getState(), 'undo')).toBeNull();
    expect(selectNextStep(store.getState(), 'redo')).toBeNull();
    expect(selectLiveStepOnTop(store.getState())).toBeNull();
  });

  it('the newest live step is the present one, and only with a past', () => {
    const { store } = setup();
    store.dispatch(pushLiveStep(liveStep(1)));
    expect(selectLiveStepOnTop(store.getState())).toEqual(liveStep(1));
    store.dispatch(set(saved(2)));
    expect(selectLiveStepOnTop(store.getState())).toBeNull();
  });

  it('the 16th step drops the oldest, whatever its kind', () => {
    const { store, history } = setup();
    const l1 = liveStep(1);
    store.dispatch(pushLiveStep(l1));
    for (let i = 1; i <= STACK_LEVEL; i++) store.dispatch(set(saved(i)));

    const { past, present } = history();
    expect(past.length).toBe(STACK_LEVEL);
    const stepIds = [...past.slice(1), present].map((s) => s.liveStep?.id);
    expect(stepIds).not.toContain(l1.id);
  });

  it('a new step of either kind clears redo', () => {
    const afterSet = setup();
    afterSet.store.dispatch(set(saved(1)));
    afterSet.store.dispatch(undo());
    expect(afterSet.history().future.length).toBe(1);
    afterSet.store.dispatch(set(saved(2)));
    expect(afterSet.history().future).toEqual([]);

    const afterPush = setup();
    afterPush.store.dispatch(set(saved(1)));
    afterPush.store.dispatch(undo());
    expect(afterPush.history().future.length).toBe(1);
    afterPush.store.dispatch(pushLiveStep(liveStep(2)));
    expect(afterPush.history().future).toEqual([]);
  });

  it('a live step never changes the saved container', () => {
    const { store, history } = setup();
    store.dispatch(set(saved(1)));
    const l = liveStep(2);
    const container = () => history().present.tabContainerDataState;

    let before = container();
    store.dispatch(pushLiveStep(l));
    expect(container()).toBe(before);

    before = container();
    store.dispatch(liveStepUndone(l));
    expect(container()).toBe(before);

    before = container();
    store.dispatch(liveStepRedone(l));
    expect(container()).toBe(before);

    before = container();
    store.dispatch(liveStepDropped({ id: l.id }));
    expect(container()).toBe(before);
  });

  it('a reply for a step that is no longer newest changes nothing', () => {
    const { store, history } = setup();
    const l1 = liveStep(1);
    store.dispatch(pushLiveStep(l1));
    store.dispatch(set(saved(2)));

    let before = history();
    store.dispatch(liveStepUndone({ ...l1 }));
    expect(history()).toEqual(before);

    before = history();
    store.dispatch(liveStepDropped({ id: l1.id }));
    expect(history()).toEqual(before);
  });

  it('a redo for an id that is not next in line changes nothing', () => {
    const { store, history } = setup();
    store.dispatch(pushLiveStep(liveStep(1)));
    store.dispatch(liveStepUndone(liveStep(1)));
    const before = history();
    store.dispatch(liveStepRedone(liveStep(99)));
    expect(history()).toEqual(before);
  });

  it('dropping the newest live step removes it; dropping a redo entry removes only that', () => {
    const { store, history } = setup();
    store.dispatch(set(saved(1)));
    store.dispatch(pushLiveStep(liveStep(2)));
    store.dispatch(liveStepDropped({ id: 2 }));
    expect(history().present.liveStep).toBeUndefined();
    expect(history().past.length).toBe(1);
    expect(history().future).toEqual([]);

    store.dispatch(pushLiveStep(liveStep(3)));
    store.dispatch(set(saved(4)));
    store.dispatch(undo());
    store.dispatch(liveStepUndone(liveStep(3)));
    // future is now [L3, saved(4)]; drop the live one only.
    expect(history().future.length).toBe(2);
    store.dispatch(liveStepDropped({ id: 3 }));
    expect(history().future.length).toBe(1);
    expect(history().future[0].liveStep).toBeUndefined();
    expect(history().present.liveStep).toBeUndefined();
  });

  it('selection and startup keep the live step', () => {
    const l1 = liveStep(1);

    const a = setup();
    a.store.dispatch(pushLiveStep(l1));
    a.store.dispatch(setPresentWithoutHistory(saved(5)));
    expect(a.history().present.liveStep).toEqual(l1);

    const b = setup();
    b.store.dispatch(pushLiveStep(l1));
    b.store.dispatch(setPresentStartup(saved(5)));
    expect(b.history().present.liveStep).toEqual(l1);
  });

  it('a wiped history keeps live steps in order', () => {
    const { store, history } = setup();
    const loaded = buildContainer();
    store.dispatch(set(saved(1)));
    store.dispatch(pushLiveStep(liveStep(2)));
    store.dispatch(set(saved(3)));
    store.dispatch(pushLiveStep(liveStep(4)));
    store.dispatch(liveStepUndone(liveStep(4)));

    store.dispatch(resetHistory({ tabContainerDataState: loaded }));

    const { past, present, future } = history();
    expect(selectNextStep(store.getState(), 'undo')).toBe('live');
    expect(present.liveStep?.id).toBe(2);
    expect(past.length).toBe(1);
    expect(future.map((s) => s.liveStep?.id)).toEqual([4]);
    for (const s of [...past, present, ...future]) {
      expect(s.tabContainerDataState).toEqual(loaded);
      expect(s.addedTabGroupIds).toEqual([]);
    }
  });

  it('a wipe keeps several live steps in the order they were made', () => {
    const { store, history } = setup();
    const loaded = buildContainer();
    store.dispatch(pushLiveStep(liveStep(1)));
    store.dispatch(set(saved(2)));
    store.dispatch(pushLiveStep(liveStep(3)));
    store.dispatch(pushLiveStep(liveStep(4)));

    store.dispatch(resetHistory({ tabContainerDataState: loaded }));

    const { past, present } = history();
    expect([...past.slice(1), present].map((s) => s.liveStep?.id)).toEqual([
      1, 3, 4,
    ]);
  });

  it('a wipe never revives a live step that aged out of the history', () => {
    const { store, history } = setup();
    const loaded = buildContainer();
    store.dispatch(pushLiveStep(liveStep(1)));
    for (let i = 1; i <= STACK_LEVEL; i++) store.dispatch(set(saved(i)));
    for (let i = 0; i < STACK_LEVEL; i++) store.dispatch(undo());
    // present is now L1's entry, but with no past it is the base, not a step.
    expect(history().past).toEqual([]);
    expect(history().present.liveStep?.id).toBe(1);

    store.dispatch(resetHistory({ tabContainerDataState: loaded }));

    expect(history().past).toEqual([]);
    expect(history().present).toEqual({
      tabContainerDataState: loaded,
      addedTabGroupIds: [],
    });
  });

  it("CONTROL: a wipe with no live steps is today's wipe", () => {
    const { store, history } = setup();
    const loaded = buildContainer();
    store.dispatch(set(saved(1)));
    store.dispatch(set(saved(2)));
    store.dispatch(undo());

    store.dispatch(resetHistory({ tabContainerDataState: loaded }));

    expect(history().past).toEqual([]);
    expect(history().future).toEqual([]);
    expect(history().present).toEqual({
      tabContainerDataState: loaded,
      addedTabGroupIds: [],
    });
  });
});

// KAN-893. A saved tab dropped into Currently open: tab 11 in window 1, at slot 2 of group 5.
function opened(tabId: number): OpenedCopy {
  return {
    kind: 'opened',
    tabs: [
      {
        tabId,
        place: { ...place, index: 2, groupId: 5 },
        openedUrl: 'https://a.test/',
        saved: { tabId: 's', favicon: '', title: 'a', url: 'https://a.test/' },
      },
    ],
    group: null,
    madeWindow: null,
    reopen: { at: 'slot', windowId: 1, index: 2, groupId: 5 },
    goToURLText: 'Visit Site',
  };
}

describe('a drop into Currently open in the undo history (KAN-893)', () => {
  it('round-trips through undo and redo unchanged', () => {
    const { store, history } = setup();
    const step = { id: 7, drop: opened(11) };
    store.dispatch(pushLiveStep(step));
    expect(history().present.liveStep).toEqual(step);
    store.dispatch(liveStepUndone(step));
    expect(history().future[0].liveStep).toEqual(step);
    store.dispatch(liveStepRedone(step));
    expect(history().present.liveStep).toEqual(step);
    expect(isOpenedCopy(step.drop)).toBe(true);
    expect(isOpenedCopy(drop(1))).toBe(false);
  });

  it('a redo with new ids renames them in the later steps of each kind, and only those', () => {
    const { store, history } = setup();
    const dropStep = { id: 1, drop: opened(11) };
    const move: LiveStep = { id: 2, drop: drop(11) };
    const other: LiveStep = { id: 3, drop: drop(12) };
    const later: LiveStep = { id: 4, drop: opened(11) };
    for (const step of [dropStep, move, other, later])
      store.dispatch(pushLiveStep(step));
    for (const step of [later, other, move, dropStep])
      store.dispatch(liveStepUndone(step));

    store.dispatch(
      liveStepRedone({
        ...dropStep,
        renamed: { tabs: [[11, 21]], windows: [], groups: [[5, 15]] },
      })
    );

    const [m, o, l] = history().future.map((s) => s.liveStep?.drop);
    expect(m).toEqual({
      kind: 'tab',
      moved: [{ tabId: 21, before: place, after: { ...place, index: 1 } }],
    });
    expect(o).toEqual(drop(12));
    expect(l).toEqual({
      ...opened(21),
      reopen: { at: 'slot', windowId: 1, index: 2, groupId: 15 },
      tabs: [
        { ...opened(21).tabs[0], place: { ...place, index: 2, groupId: 15 } },
      ],
    });
  });

  it('keepOpenedStep pushes a drop that opened tabs, and nothing for one that opened none', () => {
    const { store, history } = setup();
    expect(
      keepOpenedStep(store.dispatch, { ...opened(11), tabs: [] })
    ).toBeNull();
    expect(history().present.liveStep).toBeUndefined();
    const id = keepOpenedStep(store.dispatch, opened(11));
    expect(history().present.liveStep).toEqual({ id, drop: opened(11) });
  });

  it('renameIds on a step naming no renamed id returns an equal step', () => {
    const none = {
      tabs: [[99, 98]],
      windows: [[8, 9]],
      groups: [[7, 6]],
    } as const;
    const copy = {
      ...opened(11),
      madeWindow: { windowId: 3, stubTabId: 30 },
    };
    expect(renameIds(copy, none)).toEqual(copy);
    expect(renameIds(drop(11), none)).toEqual(drop(11));
  });

  it('a made window is renamed with its stub and the window a new-window step reopens', () => {
    const copy: OpenedCopy = {
      ...opened(11),
      tabs: [{ ...opened(11).tabs[0], place: { ...place, windowId: 3 } }],
      madeWindow: { windowId: 3, stubTabId: 30 },
    };
    const renamed = renameIds(copy, {
      tabs: [
        [11, 21],
        [30, 40],
      ],
      windows: [[3, 4]],
      groups: [],
    });
    expect(renamed).toEqual({
      ...copy,
      tabs: [{ ...copy.tabs[0], tabId: 21, place: { ...place, windowId: 4 } }],
      madeWindow: { windowId: 4, stubTabId: 40 },
    });
  });
});

describe('nextActionNumber', () => {
  it('only grows', () => {
    const a = nextActionNumber();
    const b = nextActionNumber();
    const c = nextActionNumber();
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
