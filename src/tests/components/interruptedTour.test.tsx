import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  ensureCloudSession: () => {},
  isCloudConfigured: false,
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
} from '../../redux/slices/settingsDataStateSlice';
import { holdTourLock } from '../../utils/functions/tourLock';

// KAN-413. An interrupted tour, checked on a real open.

const SETTINGS = {
  cloudConsent: 'declined' as const,
  isAutoSync: false,
  sampleTour: {
    sampleId: 'sample:left',
    step: 3 as const,
    view: 'popup' as const,
  },
};
const seeded = (store: { dispatch: (action: unknown) => void }) => {
  store.dispatch(
    settingsDataStateSlice.actions.replaceState({
      ...settingsInitial,
      ...SETTINGS,
    })
  );
  localStorage.setItem('settingsData', JSON.stringify(SETTINGS));
};

let locks: FakeLocks;
beforeEach(() => {
  localStorage.clear();
  locks = installFakeLocks();
  localStorage.setItem(
    'tabContainerData',
    JSON.stringify(
      buildContainer([
        buildSession({
          tabGroupId: 'sample:left',
          title: 'Sample: Weekend trip',
        }),
        buildSession({ tabGroupId: 'mine', title: 'Mine' }),
      ])
    )
  );
});
afterEach(() => {
  locks.uninstall();
  localStorage.clear();
  delete document.documentElement.dataset.tourCheck;
  delete document.documentElement.dataset.firstOpen;
});

describe('the open-time check', () => {
  test('a tour whose page is gone ends after the first load, and its sample goes', async () => {
    const { store } = await renderWithProviders(<App />, { seedStore: seeded });
    await waitFor(() =>
      expect(document.documentElement.dataset.tourCheck).toBe('ended')
    );
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['Mine']);
    expect(store.getState().settingsDataState.sampleTour).toBeNull();
  });

  test('a tour whose lock another page holds is left alone', async () => {
    await holdTourLock('sample:left');
    const { store } = await renderWithProviders(<App />, { seedStore: seeded });
    await waitFor(() =>
      expect(document.documentElement.dataset.tourCheck).toBe('elsewhere')
    );
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['Sample: Weekend trip', 'Mine']);
  });
});
