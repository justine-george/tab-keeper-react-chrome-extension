import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  ensureCloudSessionReady: vi.fn(),
}));
// Mocked where the sync thunk reaches it (see syncWaitsForSignIn.test.tsx).
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  ensureCloudSessionReady: mocks.ensureCloudSessionReady,
  displayToast: vi.fn(),
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

// KAN-289. When the anonymous sign-in fails, ensureCloudSessionReady now
// rejects instead of never settling. Both manual starters must turn that into
// the state a failed sync already has -- the sync_problem glyph and the "Last
// sync failed" card -- and must not read: the rules deny a read without
// request.auth, and a denied read is not "no document" (KAN-264/266).

const SYNC_STARTED = 'global/syncStateWithFirestore/pending';

describe('a failed sign-in shows as a failed sync (KAN-289)', () => {
  beforeEach(() => {
    mocks.ensureCloudSessionReady
      .mockReset()
      .mockRejectedValue(new Error('auth/too-many-requests'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('the header Sync now reports the failure and does not read', async () => {
    const user = userEvent.setup();
    const { seen, store } = await renderWithProviders(<MenuContainer />, {
      seedStore: (s) => {
        s.dispatch(grantCloudConsent());
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
        s.dispatch(setSyncStatus('idle'));
      },
    });
    seen.length = 0;

    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    await act(async () => {});

    expect(store.getState().globalState.syncStatus).toBe('error');
    expect(seen).not.toContain(SYNC_STARTED);
  });

  test("the consent dialog's sync-once reports the failure and does not read", async () => {
    const user = userEvent.setup();
    const { seen, store } = await renderWithProviders(<CloudConsentModal />, {
      seedStore: (s) => {
        s.dispatch(declineCloudConsent());
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
        s.dispatch(setSyncStatus('idle'));
        s.dispatch(
          openCloudConsentModal({ variant: 'enable', then: 'syncNow' })
        );
      },
    });
    const dialog = screen.getByRole('dialog');
    seen.length = 0;

    await user.click(within(dialog).getByRole('button', { name: 'Sync' }));
    await act(async () => {});

    expect(store.getState().globalState.syncStatus).toBe('error');
    expect(seen).not.toContain(SYNC_STARTED);
  });
});
