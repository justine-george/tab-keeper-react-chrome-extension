import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import {
  selectAwaitsBootSync,
  setCloudConfigured,
  setSignedIn,
} from '../../redux/slices/globalStateSlice';
import {
  grantCloudConsent,
  setAutoSync,
} from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';

// KAN-750. The sync glyph shows the boot sync while sign-in is pending, i.e.
// from "has a sync identity" until the first sync actually starts.
const SYNC_PENDING = 'global/syncStateWithFirestore/pending';
const SAVE_PENDING = 'global/saveToFirestoreIfDirty/pending';

function readyStore() {
  const { store } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setCloudConfigured(true));
  store.dispatch(grantCloudConsent());
  return store;
}

describe('hasStartedSync', () => {
  it('starts false', () => {
    expect(makeTestStore().store.getState().globalState.hasStartedSync).toBe(
      false
    );
  });

  it.each([SYNC_PENDING, SAVE_PENDING])(
    'turns true on the first %s and stays',
    (type) => {
      const { store } = makeTestStore();
      store.dispatch({ type });
      expect(store.getState().globalState.hasStartedSync).toBe(true);
      store.dispatch({ type: type.replace('pending', 'fulfilled') });
      store.dispatch({ type: type.replace('pending', 'rejected'), meta: {} });
      expect(store.getState().globalState.hasStartedSync).toBe(true);
    }
  );
});

describe('selectAwaitsBootSync', () => {
  it('is true when signed in, consented, auto sync on, configured, nothing started', () => {
    expect(selectAwaitsBootSync(readyStore().getState())).toBe(true);
  });

  it('is false once a sync has started', () => {
    const store = readyStore();
    store.dispatch({ type: SAVE_PENDING });
    expect(selectAwaitsBootSync(store.getState())).toBe(false);
  });

  it('is false with Auto Sync off', () => {
    const store = readyStore();
    store.dispatch(setAutoSync(false));
    expect(selectAwaitsBootSync(store.getState())).toBe(false);
  });

  it('is false without consent', () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setCloudConfigured(true));
    expect(selectAwaitsBootSync(store.getState())).toBe(false);
  });

  it('is false when not signed in or cloud not configured', () => {
    const a = readyStore();
    a.dispatch(setCloudConfigured(false));
    expect(selectAwaitsBootSync(a.getState())).toBe(false);
    const { store: b } = makeTestStore();
    b.dispatch(setCloudConfigured(true));
    b.dispatch(grantCloudConsent());
    expect(selectAwaitsBootSync(b.getState())).toBe(false);
  });
});
