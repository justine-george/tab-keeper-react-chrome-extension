import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  ensureCloudSession: vi.fn(),
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
}));
vi.mock('../../config/firebase', () => ({
  ensureCloudSession: mocks.ensureCloudSession,
  observeAuthState: vi.fn(),
  signInUserAnonymously: () => {},
  isCloudConfigured: true,
}));
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: vi.fn(async () => undefined),
  ensureCloudSessionReady: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-290. Turning Auto Sync on used to start the sign-in (fire-and-forget)
// AND a sync in the same tick. The read went out before request.auth existed,
// the rules refused it, and the card said "Last sync failed" for ~250 ms on a
// perfectly good connection until App's own sync recovered it.
//
// App's sync effect already owns this: it depends on syncAllowed (consent AND
// Auto Sync), starts the sign-in when that turns true, and syncs once
// isFirebaseAuthed flips. So the contract is two halves, and both are here:
// no read before auth, and exactly one sync once auth lands.

const SYNC_STARTED = 'global/syncStateWithFirestore/pending';
const DAY = 24 * 60 * 60 * 1000;

const seedSettings =
  (partial: Partial<SettingsData>) =>
  (s: { dispatch: (a: unknown) => void }) => {
    s.dispatch(
      settingsDataStateSlice.actions.replaceState({
        ...settingsInitial,
        ...partial,
      })
    );
    localStorage.setItem('settingsData', JSON.stringify(partial));
  };

const openSyncPane = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Sync & Backup' }));
  return user;
};

describe('turning Auto Sync on waits for sign-in (KAN-290)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.ensureCloudSession.mockReset();
    mocks.loadFromFirestore.mockReset().mockResolvedValue(undefined);
  });

  test('no sync starts before Firebase auth lands; exactly one once it does', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: 'granted',
      isAutoSync: false,
    });
    const { store, seen } = await renderWithProviders(<App />, {
      seedStore: (s) => {
        seed(s);
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
      },
    });
    const user = await openSyncPane();
    seen.length = 0;

    await user.click(
      within(screen.getByRole('group', { name: 'Auto Sync' })).getByRole(
        'button',
        { name: 'On' }
      )
    );

    // The defect: a read before request.auth exists.
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
    expect(seen.filter((t) => t === SYNC_STARTED)).toHaveLength(0);
    expect(mocks.loadFromFirestore).not.toHaveBeenCalled();
    // The sign-in itself did start (App's effect), or nothing ever would.
    expect(mocks.ensureCloudSession).toHaveBeenCalled();

    // CONTROL half: auth lands and the sync happens, once.
    act(() => {
      store.dispatch(setFirebaseAuthed());
    });
    await vi.waitFor(() =>
      expect(seen.filter((t) => t === SYNC_STARTED)).toHaveLength(1)
    );
    expect(mocks.loadFromFirestore).toHaveBeenCalledTimes(1);
  });
});
