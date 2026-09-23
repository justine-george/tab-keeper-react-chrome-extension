import { describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import { makeTestStore } from '../setup/makeStore';
import {
  grantCloudConsent,
  setAutoSync,
  timedCloudReadAllowed,
} from '../../redux/slices/settingsDataStateSlice';
import {
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';

// KAN-279 D11. The tab's periodic/on-focus cloud read must NOT go through
// merely because a sync is possible (that is drainQueuedSync's gate, consent
// alone) -- it must mirror App's startup-sync condition EXACTLY:
// `isSignedIn && isFirebaseAuthed && userId && cloudSyncAllowed(settings)`
// (App.tsx ~line 255, Justine's ruling). A timed read nobody asked for is a
// sync nobody asked for, and syncStateWithFirestore also uploads local
// edits -- with Auto Sync off this must never fire on its own. Do not "unify"
// this with drainQueuedSync's gate; they read different things on purpose.

// A store in the exact state that satisfies every one of the five facts.
function fullyAllowedStore() {
  const made = makeTestStore();
  made.store.dispatch(setSignedIn());
  made.store.dispatch(setFirebaseAuthed());
  made.store.dispatch(setUserId('u1'));
  made.store.dispatch(grantCloudConsent());
  made.store.dispatch(setAutoSync(true));
  return made;
}

describe('timedCloudReadAllowed', () => {
  test('true when signed in, authed, has a userId, consent granted, and Auto Sync on', () => {
    const { store } = fullyAllowedStore();

    expect(timedCloudReadAllowed(store.getState())).toBe(true);
  });

  // Six cases total (this one plus the five below), each mutation-proven: a
  // gate that dropped any one of the five facts would still read true here.
  test('false: signed out', () => {
    const made = makeTestStore();
    made.store.dispatch(setFirebaseAuthed());
    made.store.dispatch(setUserId('u1'));
    made.store.dispatch(grantCloudConsent());
    made.store.dispatch(setAutoSync(true));

    expect(timedCloudReadAllowed(made.store.getState())).toBe(false);
  });

  test('false: not Firebase-authed', () => {
    const made = makeTestStore();
    made.store.dispatch(setSignedIn());
    made.store.dispatch(setUserId('u1'));
    made.store.dispatch(grantCloudConsent());
    made.store.dispatch(setAutoSync(true));

    expect(timedCloudReadAllowed(made.store.getState())).toBe(false);
  });

  test('false: no userId', () => {
    const made = makeTestStore();
    made.store.dispatch(setSignedIn());
    made.store.dispatch(setFirebaseAuthed());
    made.store.dispatch(grantCloudConsent());
    made.store.dispatch(setAutoSync(true));

    expect(timedCloudReadAllowed(made.store.getState())).toBe(false);
  });

  test('false: consent not granted', () => {
    const made = makeTestStore();
    made.store.dispatch(setSignedIn());
    made.store.dispatch(setFirebaseAuthed());
    made.store.dispatch(setUserId('u1'));
    made.store.dispatch(setAutoSync(true));

    expect(timedCloudReadAllowed(made.store.getState())).toBe(false);
  });

  test('false: Auto Sync off', () => {
    const made = makeTestStore();
    made.store.dispatch(setSignedIn());
    made.store.dispatch(setFirebaseAuthed());
    made.store.dispatch(setUserId('u1'));
    made.store.dispatch(grantCloudConsent());
    made.store.dispatch(setAutoSync(false));

    expect(timedCloudReadAllowed(made.store.getState())).toBe(false);
  });
});
