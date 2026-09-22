import { describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The sign-in is held open by the test, and released when it says so.
const mocks = vi.hoisted(() => {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    ensureCloudSession: vi.fn(),
    ensureCloudSessionReady: vi.fn(() => ready),
    release: () => release(),
  };
});
vi.mock('../../config/firebase', () => ({
  ensureCloudSession: mocks.ensureCloudSession,
  ensureCloudSessionReady: mocks.ensureCloudSessionReady,
  observeAuthState: vi.fn(),
  signInUserAnonymously: () => {},
  isCloudConfigured: true,
}));

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { CloudConsentModal } from '../../components/modals/CloudConsentModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openCloudConsentModal,
  setSignedIn,
  setSyncStatus,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-266. The boot sync waits for isFirebaseAuthed; the two manual starters
// -- the header's Sync now and the consent dialog's "sync once" -- called
// ensureCloudSession (fire-and-forget) and dispatched the sync in the same
// tick. The rules deny a read without request.auth, loadFromFirestore read
// the denial as "no document yet", and by the time the local-only branch
// wrote, sign-in had landed: local state replaced the other device's
// document. Both starters now wait for the session the way deleteCloudData
// already does (KAN-259).
//
// Asserted on the action log: the sync's own pending action must be absent
// while sign-in is held, and present once it is released. The thunk itself
// is recorded only as 'THUNK', which cannot say which one.

const SYNC_STARTED = 'global/syncStateWithFirestore/pending';

describe('a manual sync waits for sign-in before it reads (KAN-266)', () => {
  test('the header Sync now does not read until the session is ready', async () => {
    const user = userEvent.setup();
    const { seen } = await renderWithProviders(<MenuContainer />, {
      seedStore: (s) => {
        s.dispatch(grantCloudConsent());
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
        s.dispatch(setSyncStatus('idle'));
      },
    });
    seen.length = 0;

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    // The defect: the read started before sign-in had landed.
    expect(seen).not.toContain(SYNC_STARTED);
    expect(mocks.ensureCloudSessionReady).toHaveBeenCalled();

    await act(async () => {
      mocks.release();
    });

    expect(seen).toContain(SYNC_STARTED);
  });

  test("the consent dialog's sync-once does not read until the session is ready", async () => {
    const user = userEvent.setup();
    mocks.ensureCloudSessionReady.mockClear();
    const { seen } = await renderWithProviders(<CloudConsentModal />, {
      seedStore: (s) => {
        s.dispatch(declineCloudConsent());
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
        s.dispatch(
          openCloudConsentModal({ variant: 'enable', then: 'syncNow' })
        );
      },
    });
    const dialog = screen.getByRole('dialog');
    seen.length = 0;

    await user.click(within(dialog).getByRole('button', { name: 'Sync' }));

    // The promise was released by the first test, so here the wait resolves
    // at once; what this pins is that the starter goes THROUGH the wait.
    expect(mocks.ensureCloudSessionReady).toHaveBeenCalled();
    await act(async () => {});
    expect(seen).toContain(SYNC_STARTED);
  });
});
