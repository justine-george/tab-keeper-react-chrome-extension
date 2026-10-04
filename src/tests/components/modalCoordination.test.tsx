import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Firebase is the only reason App cannot just be mounted: observeAuthState
// opens a real onAuthStateChanged subscription against a live auth object.
// Nothing in this file is about auth, so it is stubbed to a no-op. App then
// takes its localStorage branch, because isFirebaseAuthed never flips.
vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  // Reached once a seeded grant makes syncAllowed true; no cloud in this file.
  ensureCloudSession: () => {},
  // App writes this into the store at boot (KAN-248); its value is not
  // exercised here.
  isCloudConfigured: false,
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const DAY = 24 * 60 * 60 * 1000;

// Two tab groups open, permission ungranted -- everything the tab-groups offer
// needs. Held constant across both tests below so the ONLY difference is
// whether the rate modal also wants the screen.
const twoGroupsUngranted = {
  tabs: [{ groupId: 11 }, { groupId: 12 }, { groupId: -1 }],
};

// KAN-74. Both modals are position:fixed at z-index 999, so they must never
// open together; openFirstDialog opens only the first yes in its ordered list.
// The decisions are covered elsewhere; this pins the order App's list gives.
describe('modal coordination on popup open', () => {
  test('the rate request wins, and the tab-groups offer stands down', async () => {
    // A session restored an hour ago, never rated, never asked -> the rate
    // modal fires. KAN-149: the install date used to be what opened it, and no
    // longer is -- a value moment is. The install age stays in the fixture
    // because it is part of a realistic settings blob, not because it decides
    // anything.
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        extensionInstalledTime: Date.now() - 2 * DAY,
        lastValueMomentTime: Date.now() - 60 * 60 * 1000,
        // KAN-259: a user who has answered the cloud question, or it would
        // take the screen first and both of these would stand down.
        cloudConsent: 'granted',
      })
    );

    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });

    await waitFor(() =>
      expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
    );

    // The offer's own conditions are all met; only the rate modal suppresses it.
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
  });

  // The control. Same seed, same value moment -- only the rate modal is taken
  // out of the running. Without this, the test above passes just as well
  // against an App that never opens the tab-groups offer at all.
  test('with the rate request silenced, the tab-groups offer opens', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        extensionInstalledTime: Date.now() - 2 * DAY,
        lastValueMomentTime: Date.now() - 60 * 60 * 1000,
        isNeverAskAgainToRate: true,
        cloudConsent: 'granted',
      })
    );

    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });

    await waitFor(() =>
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
    );

    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
  });

  // A brand-new user gets the cloud question (KAN-259), and BOTH of the
  // others stand down -- the tab-groups offer included, which used to be free
  // to fire on the very first open. It gets its turn on the next open, once
  // the question is answered; that path is the second test above.
  test('a first-run user gets the cloud question, and both others stand down', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });

    await waitFor(() =>
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true)
    );

    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
  });

  // KAN-7 §8. The cloud question reads the disk as it was before this open
  // wrote to it; the same open still stamps the install date.
  test('a first open is welcomed as new, though the open stamps an install date', async () => {
    const { store } = await renderWithProviders(<App />);

    await waitFor(() =>
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true)
    );
    expect(store.getState().globalState.cloudConsentVariant).toBe('welcome');
    expect(
      typeof store.getState().settingsDataState.extensionInstalledTime
    ).toBe('number');
  });
});

// The slice reads localStorage at module load, so a test seeds the store and
// the disk: the store first, since replaceState writes the previous state.
const seedSettings =
  (partial: Partial<SettingsData>) =>
  (store: { dispatch: (action: unknown) => void }) => {
    store.dispatch(
      settingsDataStateSlice.actions.replaceState({
        ...settingsInitial,
        ...partial,
      })
    );
    localStorage.setItem('settingsData', JSON.stringify(partial));
  };

const RATE_DUE = {
  cloudConsent: 'granted' as const,
  extensionInstalledTime: Date.now() - 2 * DAY,
  lastValueMomentTime: Date.now() - 60 * 60 * 1000,
};

describe('Try the full view in the order (KAN-7 §3)', () => {
  test('the welcome closing offers the full view, and marks setup pending', async () => {
    const { store } = await renderWithProviders(<App />);
    await waitFor(() =>
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true)
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Keep on this device' })
    );

    expect(store.getState().globalState.isFullViewOfferOpen).toBe(true);
    expect(store.getState().settingsDataState.setupState).toBe('pending');
  });

  test('a popup closed before the answer asks again, ahead of the rate prompt', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: seedSettings({ ...RATE_DUE, setupState: 'pending' }),
    });
    await waitFor(() =>
      expect(store.getState().globalState.isFullViewOfferOpen).toBe(true)
    );
    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
  });

  test.each([
    ['answered', { isFullViewOfferAnswered: true }],
    ['the full view opened since KAN-7', { hasOpenedFullView: true }],
    ['the full view used before KAN-7', { openNowWidth: 500 }],
  ])(
    'never once %s; the rate prompt gets the open instead',
    async (_name, change) => {
      const { store } = await renderWithProviders(<App />, {
        seedStore: seedSettings({
          ...RATE_DUE,
          setupState: 'pending',
          ...change,
        }),
      });
      // CONTROL that the queue ran: the next entry opened.
      await waitFor(() =>
        expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
      );
      expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
    }
  );

  test('never in the full view, which marks itself opened', async () => {
    history.replaceState(null, '', '?view=tab');
    try {
      const { store } = await renderWithProviders(<App />, {
        seedStore: seedSettings({ ...RATE_DUE, setupState: 'pending' }),
      });
      await waitFor(() =>
        expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
      );
      expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
      expect(store.getState().settingsDataState.hasOpenedFullView).toBe(true);
    } finally {
      history.replaceState(null, '', '?');
    }
  });

  test('an existing user’s cloud question is not followed by the offer', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: seedSettings({
        cloudConsent: '',
        extensionInstalledTime: Date.now() - 30 * DAY,
        isAutoSync: true,
      }),
    });
    await waitFor(() =>
      expect(store.getState().globalState.cloudConsentVariant).toBe('existing')
    );

    await userEvent.click(screen.getByRole('button', { name: 'Keep sync on' }));

    expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
    expect(store.getState().settingsDataState.setupState).toBe('none');
  });
});

describe('the pin guide in the order (KAN-7 §4)', () => {
  const asFullView = async (
    action: ChromeSeed['action'],
    settings: Partial<SettingsData>
  ) => {
    history.replaceState(null, '', '?view=tab');
    return renderWithProviders(<App />, {
      seed: { action },
      seedStore: seedSettings({ ...RATE_DUE, ...settings }),
    });
  };
  afterEach(() => history.replaceState(null, '', '?'));

  test('the full view of an unpinned machine shows it, ahead of the rate prompt', async () => {
    const { store } = await asFullView({ isOnToolbar: false }, {});
    await waitFor(() =>
      expect(store.getState().globalState.isPinGuideOpen).toBe(true)
    );
    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
  });

  test.each([
    ['pinned', { isOnToolbar: true }, {}],
    ['no getUserSettings', {}, {}],
    // Review Focus 2: a throwing check counts as no; the next entry still opens.
    [
      'getUserSettings throws',
      { isOnToolbar: false, getUserSettingsThrows: true },
      {},
    ],
    ['dismissed here', { isOnToolbar: false }, { isPinGuideDismissed: true }],
  ] as const)(
    '%s: no guide, and the rate prompt gets the open',
    async (_name, action, settings) => {
      const { store } = await asFullView(action, settings);
      await waitFor(() =>
        expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
      );
      expect(store.getState().globalState.isPinGuideOpen).toBe(false);
    }
  );

  test('never in the popup', async () => {
    history.replaceState(null, '', '?');
    const { store } = await renderWithProviders(<App />, {
      seed: { action: { isOnToolbar: false } },
      seedStore: seedSettings(RATE_DUE),
    });
    await waitFor(() =>
      expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
    );
    expect(store.getState().globalState.isPinGuideOpen).toBe(false);
  });

  test('a welcome answered in the full view goes to the guide, not the offer', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = await renderWithProviders(<App />, {
      seed: { action: { isOnToolbar: false } },
    });
    await waitFor(() =>
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true)
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Keep on this device' })
    );

    await waitFor(() =>
      expect(store.getState().globalState.isPinGuideOpen).toBe(true)
    );
    expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
    expect(store.getState().settingsDataState.setupState).toBe('pending');
  });
});
