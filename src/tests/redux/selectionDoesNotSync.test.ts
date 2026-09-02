import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { IS_DIRTY_ACTION, SET_ACTION } from '../../utils/constants/actionTypes';
import { setSignedIn } from '../../redux/slices/globalStateSlice';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';

const SYNC_PENDING_ACTION = 'global/syncStateWithFirestore/pending';

// KAN-35. Selecting a session is view state: it belongs in localStorage and in
// undo/redo, but it must not reach the network.
//
// Two describes, deliberately at different depths.
//
// The first asserts on setIsDirty, the flag the middleware branch sets. It is
// one step upstream of the network, so it pins the branch itself regardless of
// auth state -- but on its own it would be a proxy for the ticket's claim
// rather than the claim.
//
// The second signs in and asserts on the sync thunk itself. That is the
// behaviour the ticket names, and it is the one a signed-out store cannot see:
// the middleware only reaches the debounced sync when isSignedIn and isAutoSync
// are both true, so signed out there is no sync either way and a test would
// pass against completely broken code.
//
// Every describe here pairs its negative assertion with a positive control for
// the same reason: `not.toContain` passes just as happily when the harness is
// blind as when the fix works.
//
// The mutation test for this file: restore the unconditional
// `store.dispatch(setIsDirty())` in customMiddleware's data-change branch. Both
// controls must stay green and both selection tests must go red.

const buildWindow = () => ({
  windowId: 'win-1',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title: 'Window 1',
  tabs: [
    {
      tabId: 'w1-t0',
      favicon: '',
      title: 'Alpha Page',
      url: 'https://example.com/alpha',
    },
  ],
});

// A factory rather than a shared constant: saveToTabContainerInternal mutates
// its payload and Immer freezes it, so a reused object throws on the second
// dispatch.
const buildGroup = (n: number) => ({
  tabGroupId: `group-${n}`,
  title: `Group ${n}`,
  createdTime: `2026-09-01 09:0${n}:00`,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [buildWindow()],
});

// Two groups, so that selecting one is a genuine change of selection rather
// than a no-op the reducer might be excused for ignoring. saveToTabContainerInternal
// unshifts and selects what it just saved, so group-2 is selected on entry.
const seededStore = () => {
  const { store, seen } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(buildGroup(1)));
  store.dispatch(saveToTabContainerInternal(buildGroup(2)));
  seen.length = 0;
  return { store, seen };
};

describe('selection does not schedule a Firestore sync (KAN-35)', () => {
  // The control. Without this, a middleware that never dispatched setIsDirty
  // for anything at all would satisfy the two tests below.
  test('a content edit still marks the store dirty', () => {
    const { store, seen } = seededStore();

    store.dispatch(
      updateTabGroupTitle({
        tabGroupId: 'group-1',
        editableTitle: 'Renamed',
      })
    );

    expect(seen).toContain(IS_DIRTY_ACTION);
  });

  test('selecting a session does not mark the store dirty', () => {
    const { store, seen } = seededStore();

    store.dispatch(selectTabContainer('group-1'));

    expect(seen).not.toContain(IS_DIRTY_ACTION);
  });

  // Guards against the naive fix of dropping SELECT_TAB_CONTAINER_ACTION from
  // actionsToCapture, which would stop the sync by also dropping selection out
  // of undo/redo history.
  test('selecting a session is still captured into undo history', () => {
    const { store, seen } = seededStore();

    store.dispatch(selectTabContainer('group-1'));

    expect(seen).toContain(SET_ACTION);
    expect(
      store.getState().undoRedo.present.tabContainerDataState.selectedTabGroupId
    ).toBe('group-1');
  });
});

// The tests above assert on setIsDirty, which is one step upstream of the
// network: the middleware only reaches the debounced sync when isSignedIn and
// isAutoSync are both true, and a default store is signed out. That makes them
// blind to the thing the ticket actually names.
//
// These sign in, so the gate is open and the debounced thunk really would fire.
// isAutoSync already defaults to true.
describe('selection does not reach Firestore when signed in (KAN-35)', () => {
  const signedInStore = () => {
    const { store, seen } = seededStore();
    store.dispatch(setSignedIn());
    seen.length = 0;
    return { store, seen };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The control, and the one that proves the gate is genuinely open: without
  // it, a store that was somehow still signed out would pass the test below
  // while proving nothing at all.
  test('a content edit does schedule the sync thunk', () => {
    const { store, seen } = signedInStore();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-1', editableTitle: 'Renamed' })
    );
    vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);

    expect(seen).toContain(SYNC_PENDING_ACTION);
  });

  test('selecting a session does not schedule the sync thunk', () => {
    const { store, seen } = signedInStore();

    store.dispatch(selectTabContainer('group-1'));
    vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);

    expect(seen).not.toContain(SYNC_PENDING_ACTION);
  });
});
