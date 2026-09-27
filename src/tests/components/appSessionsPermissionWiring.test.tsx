import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

// Firebase is the only reason App cannot just be mounted -- see
// modalCoordination.test.tsx, the nearest existing App-level harness (there is
// no dedicated App.test.tsx, and no existing test covers App's tabGroups
// permission wiring either; this file is new, mirroring that harness).
vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  isCloudConfigured: false,
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  requestSessionsPermission,
  removeSessionsPermission,
} from '../../utils/functions/permissions';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

// Skips both first-open modals (cloud consent and the rate/tab-groups
// offers), which are not what this file is about -- see modalCoordination.
// test.tsx for their own coverage.
const skipFirstOpenModals = () =>
  localStorage.setItem(
    'settingsData',
    JSON.stringify({ cloudConsent: 'granted' })
  );

describe('App wiring: sessions permission', () => {
  test('dispatches the grant state on mount, from a profile that already holds it', async () => {
    skipFirstOpenModals();

    const { store } = await renderWithProviders(<App />, {
      seed: { grantedPermissions: ['sessions'] },
    });

    await waitFor(() =>
      expect(store.getState().globalState.hasSessionsPermission).toBe(true)
    );
  });

  test('picks up a grant, then a revoke, made outside the popup while it is open', async () => {
    skipFirstOpenModals();

    const { store } = await renderWithProviders(<App />);

    await waitFor(() =>
      expect(store.getState().globalState.hasSessionsPermission).toBe(false)
    );

    // Simulates chrome://extensions granting it, or another extension
    // surface's own request() call -- either way, App's own observer, not a
    // popup re-mount, is what has to pick this up.
    requestSessionsPermission();

    await waitFor(() =>
      expect(store.getState().globalState.hasSessionsPermission).toBe(true)
    );

    removeSessionsPermission();

    await waitFor(() =>
      expect(store.getState().globalState.hasSessionsPermission).toBe(false)
    );
  });
});
