import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

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
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
  setIsDirty,
} from '../../redux/slices/globalStateSlice';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';

const SYNC_PENDING_ACTION = 'global/syncStateWithFirestore/pending';

// KAN-70. `isSignedIn` is written by a chrome.storage.sync read -- a local
// lookup that means "a usable document id exists" and involves no network.
// Firebase anonymous auth is a round trip that lands hundreds of milliseconds
// later. Gating Firestore calls on `isSignedIn` alone therefore opens the gate
// while `request.auth` is still null, and the security rule correctly denies
// every request that goes through it: measured at 1 denied BatchGetDocuments +
// 2 denied Commits, 9 console messages, on every cold start.
//
// Both flags are booleans, so no compiler could catch the substitution. Only a
// test that holds one true and the other false can.
//
// It self-heals today, but by accident: onAuthStateChanged fires first with
// user === null, so `isSignedIn` flaps false -> true when auth lands and the
// effect re-runs. Nothing retries on purpose. These tests exist so the fix
// cannot be silently undone by a refactor that removes the flap.
describe('Firestore is not touched before Firebase auth lands (KAN-70)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A store in the exact state a cold start produces: the token has been read
  // from chrome.storage.sync, so there is a document id, but the anonymous
  // sign-in round trip has not come back yet.
  const tokenReadButAuthPending = () => {
    const made = makeTestStore();
    made.store.dispatch(setSignedIn());
    made.store.dispatch(setUserId('u1'));
    return made;
  };

  test('a dirty change does NOT schedule a sync while auth is unresolved', () => {
    const { store, seen } = tokenReadButAuthPending();

    store.dispatch(setIsDirty());
    vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);

    expect(seen).not.toContain(SYNC_PENDING_ACTION);
  });

  // THE CONTROL, and the one that makes the assertion above mean something.
  // Without it the test passes just as well against a store that never syncs
  // at all -- signed out, auto-sync off, or a middleware that lost its branch.
  test('control: the same change DOES schedule a sync once auth has landed', () => {
    const { store, seen } = tokenReadButAuthPending();

    store.dispatch(setFirebaseAuthed());
    store.dispatch(setIsDirty());
    vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);

    expect(seen).toContain(SYNC_PENDING_ACTION);
  });

  // The two flags must stay independent. If a future edit makes one imply the
  // other -- the mistake this ticket is about, in the opposite direction --
  // this fails while both tests above still pass.
  test('auth landing alone does not imply a document id exists', () => {
    const { store } = makeTestStore();

    store.dispatch(setFirebaseAuthed());

    expect(store.getState().globalState.isFirebaseAuthed).toBe(true);
    expect(store.getState().globalState.isSignedIn).toBe(false);
  });

  test('a document id alone does not imply auth has landed', () => {
    const { store } = makeTestStore();

    store.dispatch(setSignedIn());

    expect(store.getState().globalState.isSignedIn).toBe(true);
    expect(store.getState().globalState.isFirebaseAuthed).toBe(false);
  });
});
