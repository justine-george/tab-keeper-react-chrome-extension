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
  moveToNewSessionInternal,
  replaceState,
  type CarriedRef,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import {
  setFirebaseAuthed,
  setIsNotDirty,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import { redo, resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { MOVE_TO_NEW_SESSION_ACTION } from '../../utils/constants/actionTypes';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';
import {
  T0,
  container,
  sessionIds,
  sessionIn,
  tabIds,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-394 P3 Task 13, through the store: the move is one undo step, dirties,
// syncs, and undoes by withdrawing the session it made.

const SYNC_PENDING_ACTION = 'global/syncStateWithFirestore/pending';
const NEW = 'NEW';

const T1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};

const ready = () => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(container(undefined, 'S1')));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made;
};

const move = (carried: CarriedRef = T1) =>
  moveToNewSessionInternal(carried, 'Fallback', '', {
    tabGroupId: NEW,
    newWindowId: 'NEW-W',
    now: Date.now(),
  });

const data = (store: ReturnType<typeof ready>['store']) =>
  store.getState().tabContainerDataState;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('moveToNewSessionInternal in the store', () => {
  it('the action type is the one the middleware captures', () => {
    expect(MOVE_TO_NEW_SESSION_ACTION).toBe(moveToNewSessionInternal.type);
  });

  it('marks sync dirty and is one undo step', () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;

    store.dispatch(move());

    expect(sessionIds(data(store))[0]).toBe(NEW);
    expect(store.getState().globalState.isDirty).toBe(true);
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
  });

  it('signed in, the debounced sync fires', () => {
    const { store, seen } = ready();
    store.dispatch(setSignedIn());
    store.dispatch(grantCloudConsent());
    store.dispatch(setUserId('u1'));
    store.dispatch(setFirebaseAuthed());
    store.dispatch(setIsNotDirty());

    store.dispatch(move());
    vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);

    expect(seen).toContain(SYNC_PENDING_ACTION);
  });

  it('⌘Z restores the source exactly and tombstones the new session; ⌘⇧Z re-applies', () => {
    const { store } = ready();
    const before = structuredClone(data(store));

    vi.setSystemTime(T0 + 1_000);
    store.dispatch(move());
    expect(tabIds(windowIn(data(store), NEW, 'NEW-W'))).toEqual(['t1']);
    expect(store.getState().undoRedo.present.addedTabGroupIds).toEqual([NEW]);

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
    expect(sessionIn(restored, 'S1').lastModified).toBeGreaterThan(T0 + 1_000);
    expect(restored.selectedTabGroupId).toBe('S1');
    // The withdrawal is a tombstone, so another device cannot union it back;
    // the restored source has none.
    expect((restored.deletedTabGroups ?? []).map((g) => g.tabGroupId)).toEqual([
      NEW,
    ]);

    vi.setSystemTime(T0 + 3_000);
    store.dispatch(redo());

    const redone = data(store);
    expect(sessionIds(redone)[0]).toBe(NEW);
    expect(tabIds(windowIn(redone, NEW, 'NEW-W'))).toEqual(['t1']);
    expect(redone.selectedTabGroupId).toBe(NEW);
    expect(
      (redone.deletedTabGroups ?? []).map((g) => g.tabGroupId)
    ).not.toContain(NEW);
  });
});
