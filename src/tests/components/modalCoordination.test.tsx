import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// These tests pin which dialog an open picks, not when.
vi.mock('../../utils/constants/cardDelay', () => ({ CARD_DELAY_MS: 0 }));

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

// One test makes the rate check throw before it returns; the rest run the real one.
const reviewAsk = vi.hoisted(() => ({ throws: false }));
vi.mock('../../utils/functions/reviewAsk', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/functions/reviewAsk')>();
  return {
    ...actual,
    shouldAskForReview: (
      ...args: Parameters<typeof actual.shouldAskForReview>
    ) => {
      if (reviewAsk.throws) throw new Error('rate check broke');
      return actual.shouldAskForReview(...args);
    },
  };
});

import App from '../../App';
import { RUN_FINISHED_SETTINGS } from '../fixtures/firstRunFixture';
import { newRun } from '../../utils/functions/firstRun';
import { leaveSetup } from '../../redux/firstOpenFollowUps';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';

beforeEach(() => localStorage.clear());
afterEach(() => {
  reviewAsk.throws = false;
  localStorage.clear();
  delete document.documentElement.dataset.firstOpen;
  delete document.documentElement.dataset.firstOpenCard;
});

const DAY = 24 * 60 * 60 * 1000;

// Two tab groups open, permission ungranted -- everything the tab-groups offer
// needs. Held constant across both tests below so the ONLY difference is
// whether the rate modal also wants the screen.
const twoGroupsUngranted = {
  tabs: [{ groupId: 11 }, { groupId: 12 }, { groupId: -1 }],
};

// KAN-74. Both modals are top-layer dialogs, so they must never
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
        ...RUN_FINISHED_SETTINGS,
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
        ...RUN_FINISHED_SETTINGS,
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

  test('a check that throws before it returns stands down; the next opens, and the queue says so', async () => {
    reviewAsk.throws = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The rate prompt is due, so only the throw keeps it from winning.
    localStorage.setItem('settingsData', JSON.stringify(RATE_DUE));
    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });
    await waitFor(() =>
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('tabGroups')
    );
    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Could not decide the rate dialog:',
      expect.any(Error)
    );
    warn.mockRestore();
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
  ...RUN_FINISHED_SETTINGS,
  extensionInstalledTime: Date.now() - 2 * DAY,
  lastValueMomentTime: Date.now() - 60 * 60 * 1000,
};

describe('after the cloud question (KAN-7 §3)', () => {
  // The queue's barrier, then a macrotask: whatever the answer starts has landed.
  const settled = async () => {
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('cloudConsent')
    );
    await act(() => new Promise<void>((done) => setTimeout(done, 0)));
  };

  test('an existing user’s cloud question is followed by no run', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: seedSettings({
        cloudConsent: '',
        extensionInstalledTime: Date.now() - 30 * DAY,
        lastSyncedTime: Date.now() - DAY,
        isAutoSync: true,
      }),
    });
    await waitFor(() =>
      expect(store.getState().globalState.cloudConsentVariant).toBe('existing')
    );

    await userEvent.click(screen.getByRole('button', { name: 'Keep sync on' }));
    await settled();

    expect(store.getState().settingsDataState.firstRun).toBeNull();
    expect(store.getState().settingsDataState.setupState).toBe('none');
  });

  test('CONTROL: the same check sees the run the welcome’s Stay here starts', async () => {
    const { store } = await renderWithProviders(<App />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Stay here' })
    );
    await settled();

    expect(store.getState().settingsDataState.firstRun).toEqual(
      newRun('popup', 1)
    );
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
});

describe('setup in the order (KAN-7 §5)', () => {
  afterEach(() => history.replaceState(null, '', '?'));

  const full = (
    action: ChromeSeed['action'],
    settings: Partial<SettingsData>
  ) => {
    history.replaceState(null, '', '?view=tab');
    return renderWithProviders(<App />, {
      seed: { action },
      seedStore: seedSettings({ ...RATE_DUE, ...settings }),
    });
  };

  test('pending on a pinned machine: setup opens, ahead of the rate prompt', async () => {
    const { store } = await full(
      { isOnToolbar: true },
      { setupState: 'pending' }
    );
    await waitFor(() =>
      expect(store.getState().globalState.isSetupOpen).toBe(true)
    );
    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
  });

  test('pending and unpinned: setup first, and the guide when setup closes', async () => {
    const { store } = await full(
      { isOnToolbar: false },
      { setupState: 'pending' }
    );
    await waitFor(() =>
      expect(store.getState().globalState.isSetupOpen).toBe(true)
    );
    expect(store.getState().globalState.isPinGuideOpen).toBe(false);

    await act(async () => {
      await store.dispatch(leaveSetup());
    });
    expect(store.getState().globalState.isPinGuideOpen).toBe(true);
  });

  // §"Error and edge cases": no getUserSettings means no guide, and setup still shows.
  test('pending with no getUserSettings: no guide, and setup opens', async () => {
    const { store } = await full({}, { setupState: 'pending' });
    await waitFor(() =>
      expect(store.getState().globalState.isSetupOpen).toBe(true)
    );
    expect(store.getState().globalState.isPinGuideOpen).toBe(false);
  });

  test('an existing user (setup never started) never gets it', async () => {
    const { store } = await full({ isOnToolbar: true }, {});
    await waitFor(() =>
      expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
    );
    expect(store.getState().globalState.isSetupOpen).toBe(false);
  });

  test('never in the popup', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: { action: { isOnToolbar: true } },
      seedStore: seedSettings({
        ...RATE_DUE,
        setupState: 'pending',
      }),
    });
    await waitFor(() =>
      expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
    );
    expect(store.getState().globalState.isSetupOpen).toBe(false);
  });
});

describe('the full-view callout in the order (KAN-7 §6)', () => {
  const holder =
    (settings: Partial<SettingsData>) =>
    (store: { dispatch: (action: unknown) => void }) => {
      seedSettings({ cloudConsent: 'granted', ...settings })(store);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(buildContainer([buildSession()]))
      );
    };

  test('a session holder who never opened the full view gets it, and the queue says so', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: holder({}),
    });
    await waitFor(() =>
      expect(store.getState().globalState.isFullViewCalloutOpen).toBe(true)
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('fullViewCallout')
    );
  });

  test('never on an open that showed a dialog', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: holder({
        extensionInstalledTime: Date.now() - 2 * DAY,
        lastValueMomentTime: Date.now() - 60 * 60 * 1000,
      }),
    });
    await waitFor(() =>
      expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
    );
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('rate')
    );
  });
});
