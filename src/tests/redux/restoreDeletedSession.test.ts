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
}));

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  restoreDeletedSession,
  restoreDeletedSessionInternal,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { T0, session, tab, win } from '../fixtures/sessionMoveFixture';

// KAN-595. Restore from Recently deleted: back on top, selected, and stamped
// strictly after its grave so the next merge keeps it on every device.

type Store = ReturnType<typeof makeTestStore>['store'];

const HOUR = 3_600_000;
const GRAVE = T0 - HOUR;

const at = (
  id: string,
  fields: Partial<tabContainerData> = {}
): tabContainerData => ({
  ...session(id, id, T0 - 10 * HOUR, [win(`w-${id}`, [tab(`t-${id}`)])]),
  ...fields,
});

// A as it was when deleted: last changed 5 hours ago.
const deletedA = () =>
  at('A', { contentModified: T0 - 5 * HOUR, lastModified: T0 - 5 * HOUR });

const ready = (
  live: tabContainerData[],
  graves = [{ tabGroupId: 'A', deletedAt: GRAVE }]
) => {
  const made = makeTestStore();
  const c: TabMasterContainer = {
    lastModified: GRAVE,
    selectedTabGroupId: live[0]?.tabGroupId ?? null,
    tabGroups: live,
    deletedTabGroups: graves,
  };
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
const order = (store: Store) => data(store).tabGroups.map((g) => g.tabGroupId);
const restoredA = (store: Store) => {
  const found = data(store).tabGroups.find((g) => g.tabGroupId === 'A');
  if (!found) throw new Error('A is not live');
  return found;
};
const graveOf = (c: TabMasterContainer, id: string) =>
  (c.deletedTabGroups ?? []).find((g) => g.tabGroupId === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('restore outranks its grave', () => {
  it('in the same millisecond as the grave, it is stamped one after', () => {
    vi.setSystemTime(GRAVE);
    const { store } = ready([at('C')]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    expect(restoredA(store).lastModified).toBe(GRAVE + 1);
    expect(graveOf(data(store), 'A')).toBeUndefined();
  });

  it('with this clock behind the grave, it is still stamped after it', () => {
    const ahead = T0 + 5000;
    const { store } = ready([at('C')], [{ tabGroupId: 'A', deletedAt: ahead }]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    expect(restoredA(store).lastModified).toBe(ahead + 1);
  });

  it('the merge with a cloud still holding the grave keeps it', () => {
    vi.setSystemTime(GRAVE);
    const { store } = ready([at('C')]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    const cloud: TabMasterContainer = {
      lastModified: GRAVE,
      selectedTabGroupId: null,
      tabGroups: [at('C')],
      deletedTabGroups: [{ tabGroupId: 'A', deletedAt: GRAVE }],
    };
    const { merged } = mergeTabContainers(data(store), cloud, GRAVE);
    expect(merged.tabGroups.map((g) => g.tabGroupId)).toContain('A');
    expect(graveOf(merged, 'A')).toBeUndefined();
  });
});

describe('restore puts it on top, selected (P2)', () => {
  it('default order: on top, dated now, a stale rank dropped', () => {
    const { store } = ready([
      at('C', { contentModified: T0 - 2 * HOUR }),
      at('B', { contentModified: T0 - 8 * HOUR }),
    ]);
    store.dispatch(
      restoreDeletedSessionInternal({ ...deletedA(), rank: T0 - 9 * HOUR })
    );
    expect(order(store)).toEqual(['A', 'C', 'B']);
    expect(restoredA(store).contentModified).toBe(T0);
    expect(restoredA(store).rank).toBeUndefined();
    expect(data(store).selectedTabGroupId).toBe('A');
    expect(data(store).tabGroups.map((g) => g.isSelected)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('custom order: a rank above the top, as a drop there takes', () => {
    const { store } = ready([
      at('C', { rank: T0 - 2 * HOUR }),
      at('B', { rank: T0 - 8 * HOUR }),
    ]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    expect(order(store)).toEqual(['A', 'C', 'B']);
    expect(restoredA(store).rank).toBe(T0 - 2 * HOUR + 60_000);
  });

  it('into an empty list: alone, selected', () => {
    const { store } = ready([]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    expect(order(store)).toEqual(['A']);
    expect(data(store).selectedTabGroupId).toBe('A');
  });

  it('stays on top through a merge with an unchanged cloud', () => {
    const { store } = ready([
      at('C', { contentModified: T0 - 2 * HOUR }),
      at('B', { contentModified: T0 - 8 * HOUR }),
    ]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    const cloud: TabMasterContainer = {
      lastModified: GRAVE,
      selectedTabGroupId: null,
      tabGroups: [
        at('C', { contentModified: T0 - 2 * HOUR }),
        at('B', { contentModified: T0 - 8 * HOUR }),
      ],
      deletedTabGroups: [{ tabGroupId: 'A', deletedAt: GRAVE }],
    };
    const { merged } = mergeTabContainers(data(store), cloud, T0);
    expect(merged.tabGroups.map((g) => g.tabGroupId)).toEqual(['A', 'C', 'B']);
  });
});

describe('restore of a session already live', () => {
  it('changes nothing', () => {
    const { store } = ready([at('C')]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    const once = data(store);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    expect(data(store)).toBe(once);
    expect(order(store)).toEqual(['A', 'C']);
  });
});

describe('restore and undo', () => {
  it('undo buries it again, after its restored copy', () => {
    const { store } = ready([at('C')]);
    store.dispatch(restoreDeletedSessionInternal(deletedA()));
    const restoredAt = restoredA(store).lastModified ?? 0;
    store.dispatch(undo());
    expect(order(store)).toEqual(['C']);
    expect(graveOf(data(store), 'A')?.deletedAt).toBeGreaterThan(restoredAt);
  });
});

describe('the thunk', () => {
  it('restores and says so', async () => {
    const { store } = ready([at('C')]);
    await store.dispatch(restoreDeletedSession(deletedA()));
    expect(order(store)).toEqual(['A', 'C']);
    expect(store.getState().globalState.toasts.map((t) => t.text)).toContain(
      TOAST_MESSAGES.SESSION_RESTORED
    );
  });
});
