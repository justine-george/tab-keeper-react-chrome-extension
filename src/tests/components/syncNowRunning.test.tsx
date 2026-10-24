import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

// The sign-in is held open until the test settles it.
const mocks = vi.hoisted(() => ({
  ensureCloudSessionReady: vi.fn<() => Promise<void>>(),
}));
// Mocked where the sync thunk reaches it (see syncWaitsForSignIn.test.tsx).
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  ensureCloudSessionReady: mocks.ensureCloudSessionReady,
}));

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import {
  syncBusyEndedAt,
  syncPressedAt,
} from '../../components/common/useShownSyncStatus';
import {
  setCloudConfigured,
  setSignedIn,
  setSyncStatus,
  setUserId,
  syncNowWhenSignedIn,
} from '../../redux/slices/globalStateSlice';
import {
  grantCloudConsent,
  setAutoSync,
} from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-750 R12. A Sync now is committed from its press, though its sync starts
// only once sign-in lands (KAN-266). Manual-sync users wait out that sign-in
// on their first press each popup, so the flag, not syncStatus, is what says
// "Syncing…" through it.

type Store = ReturnType<typeof makeTestStore>['store'];

function heldSignIn() {
  let settle: { ok: () => void; fail: (e: Error) => void } = {
    ok: () => {},
    fail: () => {},
  };
  mocks.ensureCloudSessionReady.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { ok: resolve, fail: reject };
      })
  );
  return { ok: () => settle.ok(), fail: (e: Error) => settle.fail(e) };
}

/** Consented, Manual sync, an id, and no Firebase session yet. */
function manualUser(store: Store): void {
  store.dispatch(setSignedIn());
  store.dispatch(setCloudConfigured(true));
  store.dispatch(grantCloudConsent());
  store.dispatch(setAutoSync(false));
  store.dispatch(setUserId('uuid-1'));
  store.dispatch(setSyncStatus('idle'));
}

const running = (store: Store) => store.getState().globalState.isSyncNowRunning;

// The thunk asks for the session after its id check, a few microtasks in.
const signingIn = () =>
  vi.waitFor(() => expect(mocks.ensureCloudSessionReady).toHaveBeenCalled());

beforeEach(() => {
  mocks.ensureCloudSessionReady.mockReset();
  syncPressedAt.current = -Infinity;
  syncBusyEndedAt.current = -Infinity;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('isSyncNowRunning', () => {
  const freshStore = () => {
    setupChromeFake();
    const { store } = makeTestStore();
    manualUser(store);
    return store;
  };

  test('is set from the start of a Sync now until its sync ends', async () => {
    const store = freshStore();
    const signIn = heldSignIn();
    expect(running(store)).toBe(false);

    const done = store.dispatch(syncNowWhenSignedIn());
    expect(running(store)).toBe(true);
    await signingIn();
    expect(running(store)).toBe(true);

    signIn.ok();
    await done;
    expect(running(store)).toBe(false);
  });

  test('is cleared when sign-in fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = freshStore();
    const signIn = heldSignIn();
    const done = store.dispatch(syncNowWhenSignedIn());
    expect(running(store)).toBe(true);
    await signingIn();

    signIn.fail(new Error('auth/network-request-failed'));
    await done;
    expect(running(store)).toBe(false);
    expect(store.getState().globalState.syncStatus).toBe('error');
  });

  test('is cleared when there is no id to sync', async () => {
    setupChromeFake();
    // No stored id, and the mint's write fails: nothing to sync as.
    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValue(new Error('quota'));
    const { store } = makeTestStore();
    store.dispatch(grantCloudConsent());
    store.dispatch(setSignedIn());
    const done = store.dispatch(syncNowWhenSignedIn());
    expect(running(store)).toBe(true);
    await done;
    expect(store.getState().globalState.userId).toBeNull();
    expect(mocks.ensureCloudSessionReady).not.toHaveBeenCalled();
    expect(store.getState().globalState.syncStatus).toBe('error');
    expect(running(store)).toBe(false);
  });
});

describe('a Manual-sync press while sign-in is pending', () => {
  const glyphOf = (button: HTMLElement) => {
    const root = button.querySelector('[data-glyph]');
    return {
      glyph: root?.getAttribute('data-glyph'),
      turning: root?.getAttribute('data-turning'),
    };
  };

  test('reads Syncing…, is disabled and turns on the click itself', async () => {
    const signIn = heldSignIn();
    const { store } = await renderWithProviders(<MenuContainer />, {
      seedStore: manualUser,
    });
    // CONTROL: before the press it offers the action.
    const button = screen.getByRole('button', { name: 'Sync now' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    // A press later than the mount, on the clock the hook reads.
    await new Promise((r) => setTimeout(r, 2));

    act(() => {
      fireEvent.click(button);
    });
    expect(store.getState().globalState.syncStatus).toBe('idle');
    const syncing = screen.getByRole('button', { name: 'Syncing…' });
    expect(syncing.getAttribute('aria-disabled')).toBe('true');
    expect(glyphOf(syncing)).toEqual({ glyph: 'sync', turning: 'true' });

    // A second press while signing in starts nothing more.
    await act(signingIn);
    fireEvent.click(syncing);
    await act(async () => {});
    expect(mocks.ensureCloudSessionReady).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBe(syncing);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      signIn.fail(new Error('auth/network-request-failed'));
    });
    expect(
      screen
        .getByRole('button', { name: 'Sync now' })
        .getAttribute('aria-disabled')
    ).toBeNull();
  });
});
