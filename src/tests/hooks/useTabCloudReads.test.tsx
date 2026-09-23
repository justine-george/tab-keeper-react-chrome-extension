import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Provider } from 'react-redux';

import type { VisibilitySource } from '../../utils/functions/cloudReadScheduler';

// KAN-279 D11. useTabCloudReads() is a thin wrapper around startCloudReads
// (cloudReadScheduler.test.ts covers that scheduler's own behaviour in
// detail, with fake timers and a fake doc). This file only has to prove the
// WIRING: the effect starts the scheduler exactly when isTabView() is true,
// with the RIGHT callbacks (not just *some* callbacks -- an
// `expect.any(Function)` check let `canRead` be swapped for `cloudSyncAllowed`
// or `() => true`, and `read` for a no-op, without failing anything), and
// stops it on unmount.
//
// The mock's implementation function is typed, so `startCloudReads.mock.calls`
// is a typed tuple array -- `calls[0]` destructures to
// `[VisibilitySource, () => void, () => boolean]` with no cast. Real
// visibility is still never driven here (jsdom/Playwright/DevTools MCP can't
// fake it; see global-constraints.md); the scheduler itself is mocked out,
// and what's captured is the exact `read`/`canRead` closures the hook built.
const { startCloudReads, stopSpy } = vi.hoisted(() => {
  const stopSpy = vi.fn();
  // Typed via vi.fn's generic (a function TYPE, no implementation), rather
  // than an implementation function with named-but-unused parameters -- that
  // would need every one of the three params referenced or trip
  // @typescript-eslint/no-unused-vars. `startCloudReads.mock.calls[0]` comes
  // out typed as `[VisibilitySource, () => void, () => boolean]`, so every
  // captured-callback test below destructures it with no cast.
  const startCloudReads =
    vi.fn<
      (
        doc: VisibilitySource,
        read: () => void,
        canRead: () => boolean
      ) => () => void
    >();
  startCloudReads.mockReturnValue(stopSpy);
  return { startCloudReads, stopSpy };
});

vi.mock('../../utils/functions/cloudReadScheduler', () => ({
  startCloudReads,
}));

import { useTabCloudReads } from '../../hooks/useTabCloudReads';
import { makeTestStore } from '../setup/makeStore';
import {
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  grantCloudConsent,
  setAutoSync,
} from '../../redux/slices/settingsDataStateSlice';

function Harness() {
  useTabCloudReads();
  return null;
}

function renderHarness() {
  const made = makeTestStore();
  const result = render(
    <Provider store={made.store}>
      <Harness />
    </Provider>
  );
  return { ...result, ...made };
}

afterEach(() => {
  cleanup();
  startCloudReads.mockClear();
  stopSpy.mockClear();
  // isTabView() reads the live URL; jsdom keeps one document for the whole
  // file, so a test that moves it must put it back (same reason as
  // viewMode.test.tsx).
  window.history.replaceState(null, '', '/index.html');
});

describe('useTabCloudReads', () => {
  test('starts the scheduler in the tab view', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');

    renderHarness();

    expect(startCloudReads).toHaveBeenCalledTimes(1);
    expect(startCloudReads).toHaveBeenCalledWith(
      document,
      expect.any(Function),
      expect.any(Function)
    );
  });

  // The mutation this guards against: running the effect in the popup too.
  test('does not start the scheduler in the popup', () => {
    window.history.replaceState(null, '', '/index.html');

    renderHarness();

    expect(startCloudReads).not.toHaveBeenCalled();
  });

  test('stops the scheduler on unmount', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');
    const { unmount } = renderHarness();
    expect(stopSpy).not.toHaveBeenCalled();

    unmount();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  // The captured `canRead` reads the SAME store the
  // Provider wraps (useStore().getState(), not a snapshot taken at mount), so
  // dispatching on `store` after render and calling the captured closure
  // exercises the real gate. This is what an `expect.any(Function)` shape
  // check cannot catch: a gate swapped for `cloudSyncAllowed` (consent
  // alone) or `() => true` would also satisfy every assertion above, but
  // fails the two below.
  test('the captured canRead is timedCloudReadAllowed: false with Auto Sync off, true once it is on', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');
    const { store } = renderHarness();
    const [, , canRead] = startCloudReads.mock.calls[0];

    store.dispatch(setSignedIn());
    store.dispatch(setFirebaseAuthed());
    store.dispatch(setUserId('u1'));
    store.dispatch(grantCloudConsent());
    store.dispatch(setAutoSync(false));
    expect(canRead()).toBe(false);

    store.dispatch(setAutoSync(true));
    expect(canRead()).toBe(true);
  });

  // The substitution the toggle-only test above cannot
  // catch on its own): consent granted and Auto Sync on -- exactly what
  // drainQueuedSync's gate (customMiddleware.ts) alone would accept -- but
  // never signed in/authed with a userId. timedCloudReadAllowed must refuse;
  // a hook wired to cloudSyncAllowed instead of timedCloudReadAllowed would
  // wrongly accept, because it never looks at isSignedIn/isFirebaseAuthed/
  // userId at all.
  test('the captured canRead refuses consent+AutoSync alone, never signed in (rules out the drainQueuedSync gate)', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');
    const { store } = renderHarness();
    const [, , canRead] = startCloudReads.mock.calls[0];

    store.dispatch(grantCloudConsent());
    store.dispatch(setAutoSync(true));

    expect(canRead()).toBe(false);
  });

  // The captured `read` dispatches the real
  // syncStateWithFirestore thunk (through the queue, as the brief requires),
  // not a no-op -- asserted by the thunk's OWN pending action type
  // (`syncStateWithFirestore.pending.type`), never a hand-typed string
  // literal that could drift from the real action.
  test('the captured read dispatches syncStateWithFirestore', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');
    const { seen } = renderHarness();
    const [, read] = startCloudReads.mock.calls[0];

    read();

    expect(seen).toContain(syncStateWithFirestore.pending.type);
  });
});
