import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// The SDK is mocked, NOT loadFromFirestore: the defect is inside
// loadFromFirestore's catch, so every test that mocks it whole is blind here.
const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(async () => undefined),
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(async () => undefined),
}));
vi.mock('firebase/firestore/lite', () => ({
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  deleteDoc: vi.fn(),
  setDoc: firestore.setDoc,
  getDoc: firestore.getDoc,
}));

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-264. loadFromFirestore's catch has two branches. "No document" and
// "permission denied" both mean the cloud is empty for this user, and seeding
// it from local is right. Every OTHER failure -- offline, quota, a transient
// 5xx -- fell into an `else` that logged and returned undefined, which the
// sync could not tell apart from "no document": it took the local-only
// branch, marked local dirty, and the next write REPLACED the cloud document
// with local state without ever having read it. A device offline at boot
// overwrote what the other device had saved.
//
// Rethrowing was not an option until KAN-263: syncStateWithFirestore had no
// rejected reducer, so a throw left the status untouched and the sync died
// looking like one that had not run. Now .rejected → 'error'.

const local = buildContainer([buildSession({ tabGroupId: 'mine' })]);

// The seeding write is dispatched, not awaited, by the sync; give it a tick.
const settle = () => new Promise((r) => setTimeout(r, 20));

const signedInStore = () => {
  const { store } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  return store;
};

describe('a cloud read that fails for an unexpected reason (KAN-264)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tabContainerData', JSON.stringify(local));
    firestore.getDoc.mockReset();
    firestore.setDoc.mockReset().mockResolvedValue(undefined);
  });

  it('never writes local state over the document it could not read', async () => {
    firestore.getDoc.mockRejectedValue(
      Object.assign(new Error('network request failed'), {
        code: 'unavailable',
      })
    );
    const store = signedInStore();

    await store.dispatch(syncStateWithFirestore());

    expect(firestore.setDoc).not.toHaveBeenCalled();
    // Nothing is dirty either: a dirty flag here is a deferred overwrite,
    // sent by the next sync without a read of its own.
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  it('reports the failure as a sync problem', async () => {
    firestore.getDoc.mockRejectedValue(new Error('network request failed'));
    const store = signedInStore();

    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('error');
  });

  // CONTROL. The two failures that DO mean "empty cloud" still seed it, or
  // the assertions above would pass against a read that refuses everything.
  //
  // Exactly ONCE. loadFromFirestore used to dispatch the seeding write itself
  // AND return undefined, so syncStateWithFirestore's local-only branch wrote
  // the same document again -- and its setIsDirty also scheduled the
  // middleware's debounced full sync, a third request. The caller owns the
  // "absent" case; the read only has to report it. This is the overlap half
  // of KAN-264, as far as it is reachable from a single boot.
  it('CONTROL: a missing document is seeded from local, in one write', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    const store = signedInStore();

    await store.dispatch(syncStateWithFirestore());
    await settle();

    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    expect(store.getState().globalState.syncStatus).not.toBe('error');
  });

  it('CONTROL: a permission-denied read is seeded from local, in one write', async () => {
    firestore.getDoc.mockRejectedValue(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      })
    );
    const store = signedInStore();

    await store.dispatch(syncStateWithFirestore());
    await settle();

    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    expect(store.getState().globalState.syncStatus).not.toBe('error');
  });
});
