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

import { makeTestStore } from '../setup/makeStore';
import {
  replaceSessionContentInternal,
  replaceState,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { redo, resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import {
  T0,
  container,
  s1,
  s2,
  s3,
  sessionIds,
  sessionIn,
  tab,
  win,
} from '../fixtures/sessionMoveFixture';

// KAN-468. Replace swaps a session's windows for what is open, as one content edit.

const OPEN = [win('n1', [tab('o1'), tab('o2')]), win('n2', [tab('o3')])];

const ready = (c: TabMasterContainer = container([s3(), s2(), s1()], 'S2')) => {
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
const data = (s: ReturnType<typeof ready>['store']) =>
  s.getState().tabContainerDataState;
const replace = (tabGroupId = 'S1', now = T0) =>
  replaceSessionContentInternal({ tabGroupId, windows: OPEN, now });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('replaceSessionContentInternal', () => {
  it('takes the windows, recounts, and keeps id, name, created date and selection', () => {
    const { store } = ready();
    const before = sessionIn(data(store), 'S1');
    store.dispatch(replace());
    const after = sessionIn(data(store), 'S1');
    expect(after.windows.map((w) => w.windowId)).toEqual(['n1', 'n2']);
    expect([after.windowCount, after.tabCount]).toEqual([2, 3]);
    expect([
      after.title,
      after.createdAt,
      after.createdTime,
      after.isSelected,
    ]).toEqual([
      before.title,
      before.createdAt,
      before.createdTime,
      before.isSelected,
    ]);
    expect([after.lastModified, after.contentModified]).toEqual([T0, T0]);
  });

  it('unranked: goes first, as any edit does (KAN-141)', () => {
    const { store } = ready();
    store.dispatch(replace());
    expect(sessionIds(data(store))[0]).toBe('S1');
  });

  it('ranked: keeps its place', () => {
    const ranked = container([
      { ...s3(), rank: 30 },
      { ...s2(), rank: 20 },
      { ...s1(), rank: 10 },
    ]);
    const { store } = ready(ranked);
    store.dispatch(replace());
    expect(sessionIds(data(store))).toEqual(['S3', 'S2', 'S1']);
  });

  it('an id no session has changes nothing', () => {
    const { store } = ready();
    const before = data(store);
    store.dispatch(replace('gone'));
    expect(data(store)).toBe(before);
  });

  it('is captured by the middleware: dirty, one undo step, ⌘Z and ⌘⇧Z', () => {
    const { store } = ready();
    const before = structuredClone(sessionIn(data(store), 'S1'));
    const past = store.getState().undoRedo.past.length;
    store.dispatch(replace());
    expect(store.getState().globalState.isDirty).toBe(true);
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
    vi.setSystemTime(T0 + 1_000);
    store.dispatch(undo());
    const back = sessionIn(data(store), 'S1');
    expect(back.windows).toEqual(before.windows);
    expect([back.windowCount, back.tabCount]).toEqual([
      before.windowCount,
      before.tabCount,
    ]);
    // Back in its old place, with its old edited date.
    expect(back.contentModified).toBe(before.contentModified);
    expect(sessionIds(data(store))).toEqual(['S3', 'S2', 'S1']);
    store.dispatch(redo());
    expect(sessionIn(data(store), 'S1').windows.map((w) => w.windowId)).toEqual(
      ['n1', 'n2']
    );
  });
});
