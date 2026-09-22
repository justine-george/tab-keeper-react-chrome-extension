import { beforeEach, describe, expect, test, vi } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// A stand-in for Firebase Auth that behaves the way the SDK does where it
// matters here: a new onAuthStateChanged subscriber is told the CURRENT state
// asynchronously, and a successful sign-in sets currentUser before resolving.
const fake = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  signInAnonymously: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => fake.auth),
  onAuthStateChanged: vi.fn(
    (auth: typeof fake.auth, callback: (user: unknown) => void) => {
      queueMicrotask(() => callback(auth.currentUser));
      return () => {};
    }
  ),
  signInAnonymously: fake.signInAnonymously,
}));
vi.mock('firebase/firestore/lite', () => ({
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  getDoc: vi.fn(),
}));

// KAN-289. ensureCloudSessionReady waited for onAuthStateChanged to report a
// user, and nothing else. When signInAnonymously failed (auth/too-many-
// requests, offline), its .catch only warned, so the wait never settled:
// Sync now, the consent dialog's sync and Delete cloud data did nothing,
// with no message. And cloudSessionStarted meant no later call signed in again.

const failure = Object.assign(new Error('quota'), {
  code: 'auth/too-many-requests',
});
// Lands a macrotask later, as a network sign-up does. Landing synchronously
// would set currentUser before the session's listener first runs, and hide a
// second concurrent sign-in from the "once, not once per asker" test.
const signedIn = () =>
  new Promise<{ user: { uid: string } }>((resolve) =>
    setTimeout(() => {
      fake.auth.currentUser = { uid: 'anon-1' };
      resolve({ user: fake.auth.currentUser });
    })
  );

// What a promise has done after every queued callback has run. A wait that
// never settles reads as 'pending' here instead of hanging the test.
async function settled(promise: Promise<unknown>) {
  let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
  promise.then(
    () => (outcome = 'resolved'),
    () => (outcome = 'rejected')
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  return outcome;
}

describe('a failed anonymous sign-in is reported, not waited on (KAN-289)', () => {
  // cloudSessionStarted is module state; each test gets a fresh module.
  beforeEach(() => {
    vi.resetModules();
    fake.auth.currentUser = null;
    fake.signInAnonymously.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const load = async () => {
    const firebase = await import('../../config/firebase');
    return (dispatch = vi.fn()) => firebase.ensureCloudSessionReady(dispatch);
  };

  test('the wait rejects when sign-in fails', async () => {
    fake.signInAnonymously.mockRejectedValue(failure);
    const ready = await load();

    expect(await settled(ready())).toBe('rejected');
  });

  test('the next call signs in again, and resolves once it lands', async () => {
    fake.signInAnonymously
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(signedIn);
    const ready = await load();

    expect(await settled(ready())).toBe('rejected');
    expect(await settled(ready())).toBe('resolved');
    expect(fake.signInAnonymously).toHaveBeenCalledTimes(2);
  });

  test('the first call signs in once, not once per asker', async () => {
    // The session's own listener and the wait both want a user on the first
    // call. Two concurrent sign-ups would create two anonymous accounts.
    fake.signInAnonymously.mockImplementation(signedIn);
    const ready = await load();

    expect(await settled(ready())).toBe('resolved');
    expect(fake.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  test('an existing user resolves at once, without signing in', async () => {
    fake.auth.currentUser = { uid: 'anon-0' };
    const ready = await load();

    expect(await settled(ready())).toBe('resolved');
    expect(fake.signInAnonymously).not.toHaveBeenCalled();
  });
});
