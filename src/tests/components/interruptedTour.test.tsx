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
import { holdTourLock, tourLockName } from '../../utils/functions/tourLock';
import { buildSampleSession } from '../../utils/functions/sampleSession';

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
let nextId = 0;
beforeEach(() => {
  localStorage.clear();
  locks = installFakeLocks();
  localStorage.setItem(
    'tabContainerData',
    JSON.stringify(
      buildContainer([
        {
          ...buildSampleSession(
            {
              title: 'Sample: Weekend trip',
              gettingThere: 'Getting there',
              thingsToDo: 'Things to do',
            },
            new Date(),
            () => `id-${(nextId += 1)}`
          ),
          tabGroupId: 'sample:left',
        },
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
    await holdTourLock(tourLockName('sample:left'));
    const { store } = await renderWithProviders(<App />, { seedStore: seeded });
    await waitFor(() =>
      expect(document.documentElement.dataset.tourCheck).toBe('elsewhere')
    );
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['Sample: Weekend trip', 'Mine']);
  });
});
