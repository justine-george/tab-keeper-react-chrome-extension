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
  replaceSessionContentInternal,
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import {
  T0,
  container,
  sessionIds,
  sessionIn,
  tab,
  win,
} from '../fixtures/sessionMoveFixture';

// KAN-468. A replace is one content edit to one session; the per-session merge must treat it as any other.

const OPEN = [win('n1', [tab('o1')]), win('n2', [tab('o2')])];
const OLD = ['w1', 'w2'];

const base = (): TabMasterContainer =>
  reducer(undefined, replaceState(container()));

const aReplaces = (at: number, start = base()): TabMasterContainer => {
  vi.setSystemTime(at);
  return reducer(
    start,
    replaceSessionContentInternal({ tabGroupId: 'S1', windows: OPEN, now: at })
  );
};

const bRenames = (
  tabGroupId: string,
  at: number,
  start = base()
): TabMasterContainer => {
  vi.setSystemTime(at);
  return reducer(
    start,
    updateTabGroupTitle({ tabGroupId, editableTitle: 'Renamed on B' })
  );
};

const windowIdsOf = (c: TabMasterContainer, id: string) =>
  sessionIn(c, id).windows.map((w) => w.windowId);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a replace meets another device', () => {
  it('(a) B edits another session: S1 holds the open windows, once', () => {
    const { merged } = mergeTabContainers(
      aReplaces(T0 + 1_000),
      bRenames('S3', T0 + 2_000),
      T0 + 3_000
    );
    expect(windowIdsOf(merged, 'S1')).toEqual(['n1', 'n2']);
    expect(sessionIn(merged, 'S3').title).toBe('Renamed on B');
    expect(sessionIds(merged).filter((id) => id === 'S1')).toHaveLength(1);
  });

  it('(b) B renames S1 later, on the old content: B wins, and the open windows land nowhere else', () => {
    const { merged } = mergeTabContainers(
      aReplaces(T0 + 1_000),
      bRenames('S1', T0 + 2_000),
      T0 + 3_000
    );
    expect(sessionIn(merged, 'S1').title).toBe('Renamed on B');
    expect(windowIdsOf(merged, 'S1')).toEqual(OLD);
    expect(
      merged.tabGroups.flatMap((g) => g.windows.map((w) => w.windowId))
    ).not.toContain('n1');
  });

  it('(c) B renames S1 first, A replaces later: the replace wins', () => {
    const cloud = bRenames('S1', T0 + 1_000);
    const { merged } = mergeTabContainers(
      aReplaces(T0 + 2_000),
      cloud,
      T0 + 3_000
    );
    expect(windowIdsOf(merged, 'S1')).toEqual(['n1', 'n2']);
  });

  it('(d) A replaces, syncs, undoes: the undo wins over the synced replace', () => {
    const { store } = makeTestStore();
    store.dispatch(replaceState(base()));
    store.dispatch(
      resetHistory({
        tabContainerDataState: store.getState().tabContainerDataState,
      })
    );
    vi.setSystemTime(T0 + 1_000);
    store.dispatch(
      replaceSessionContentInternal({
        tabGroupId: 'S1',
        windows: OPEN,
        now: T0 + 1_000,
      })
    );
    const cloud = structuredClone(store.getState().tabContainerDataState);

    vi.setSystemTime(T0 + 2_000);
    store.dispatch(undo());
    const { merged } = mergeTabContainers(
      store.getState().tabContainerDataState,
      cloud,
      T0 + 3_000
    );
    expect(windowIdsOf(merged, 'S1')).toEqual(OLD);
  });
});
