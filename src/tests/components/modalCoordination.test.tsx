import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

// One test makes the tab-groups check throw before it returns; the rest run the real one.
const tabGroupsOffer = vi.hoisted(() => ({ throws: false }));
vi.mock('../../utils/functions/tabGroupsOffer', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../utils/functions/tabGroupsOffer')
    >();
  return {
    ...actual,
    shouldOfferTabGroups: (
      ...args: Parameters<typeof actual.shouldOfferTabGroups>
    ) => {
      if (tabGroupsOffer.throws) throw new Error('tab groups check broke');
      return actual.shouldOfferTabGroups(...args);
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
  tabGroupsOffer.throws = false;
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.firstOpen;
});

const DAY = 24 * 60 * 60 * 1000;

// Two tab groups open, permission ungranted -- everything the tab-groups offer
// needs. It is the last entry in both lists, so it stands for "the next
// dialog" wherever a test needs one to take the open.
const twoGroupsUngranted = {
  tabs: [{ groupId: 11 }, { groupId: 12 }, { groupId: -1 }],
};

// KAN-74. Top-layer dialogs must never open together; openFirstDialog opens
// only the first yes in its ordered list. The decisions are covered
// elsewhere; this pins the order App's list gives.
describe('modal coordination on popup open', () => {
  // KAN-653. The review card left the list: it is no dialog, and shows once
  // nothing covers the page (useReviewAskRelease). An open where an ask is
  // due -- installed two days ago, never asked -- still offers tab groups.
  test('an ask that is due takes no turn: the tab-groups offer opens', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        extensionInstalledTime: Date.now() - 2 * DAY,
        // KAN-259: a user who has answered the cloud question, or it would
        // take the screen first.
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
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('tabGroups')
    );
  });

  // KAN-653. The open's own ask, made once its dialogs have settled, and
  // shown by the release once nothing covers the page.
  test('a day after install, the open asks with the time card', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        extensionInstalledTime: Date.now() - 2 * DAY,
        cloudConsent: 'granted',
        ...RUN_FINISHED_SETTINGS,
      })
    );

    const { store } = await renderWithProviders(<App />);

    await waitFor(() =>
      expect(store.getState().globalState.reviewCard?.moment).toEqual({
        kind: 'time',
      })
    );
    expect(store.getState().settingsDataState.isTimeAskDone).toBe(true);
  });

  // A brand-new user gets the cloud question (KAN-259), and the tab-groups
  // offer stands down -- it used to be free to fire on the very first open.
  // It gets its turn on the next open, once the question is answered; that
  // path is the test above.
  test('a first-run user gets the cloud question, and the offer stands down', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });

    await waitFor(() =>
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true)
    );

    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
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

// Nothing ahead of the entry under test: the cloud question answered, the run over.
const ANSWERED = {
  cloudConsent: 'granted' as const,
  ...RUN_FINISHED_SETTINGS,
  extensionInstalledTime: Date.now() - 2 * DAY,
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

  test('CONTROL: the same check sees the run the welcome’s Show me here starts', async () => {
    const { store } = await renderWithProviders(<App />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show me here' })
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
      seed: { action, ...twoGroupsUngranted },
      seedStore: seedSettings({ ...ANSWERED, ...settings }),
    });
  };
  afterEach(() => history.replaceState(null, '', '?'));

  test('the full view of an unpinned machine shows it, ahead of the tab-groups offer', async () => {
    const { store } = await asFullView({ isOnToolbar: false }, {});
    await waitFor(() =>
      expect(store.getState().globalState.isPinGuideOpen).toBe(true)
    );
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
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
    '%s: no guide, and the tab-groups offer gets the open',
    async (_name, action, settings) => {
      const { store } = await asFullView(action, settings);
      await waitFor(() =>
        expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
      );
      expect(store.getState().globalState.isPinGuideOpen).toBe(false);
    }
  );

  test('never in the popup', async () => {
    history.replaceState(null, '', '?');
    const { store } = await renderWithProviders(<App />, {
      seed: { action: { isOnToolbar: false }, ...twoGroupsUngranted },
      seedStore: seedSettings(ANSWERED),
    });
    await waitFor(() =>
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
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
      seed: { action, ...twoGroupsUngranted },
      seedStore: seedSettings({ ...ANSWERED, ...settings }),
    });
  };

  test('pending on a pinned machine: setup opens, ahead of the tab-groups offer', async () => {
    const { store } = await full(
      { isOnToolbar: true },
      { setupState: 'pending' }
    );
    await waitFor(() =>
      expect(store.getState().globalState.isSetupOpen).toBe(true)
    );
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
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
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
    );
    expect(store.getState().globalState.isSetupOpen).toBe(false);
  });

  test('never in the popup', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: { action: { isOnToolbar: true }, ...twoGroupsUngranted },
      seedStore: seedSettings({
        ...ANSWERED,
        setupState: 'pending',
      }),
    });
    await waitFor(() =>
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
    );
    expect(store.getState().globalState.isSetupOpen).toBe(false);
  });
});

describe('the full-view callout in the order (KAN-7 §6)', () => {
  // A 2.0 session holder: What's new seen, so the popup starts no run (KAN-623).
  const holder =
    (settings: Partial<SettingsData>) =>
    (store: { dispatch: (action: unknown) => void }) => {
      seedSettings({
        cloudConsent: 'granted',
        isWhatsNew2Seen: true,
        ...settings,
      })(store);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(buildContainer([buildSession()]))
      );
    };

  test('KAN-623: an upgrader’s popup opens What’s new instead, and the queue says so', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: holder({ isWhatsNew2Seen: false }),
    });
    expect(
      await screen.findByRole('dialog', {
        name: "What's new in Tab Keeper 2.0",
      })
    ).toBeVisible();
    expect(document.documentElement.dataset.firstOpen).toBe('firstRun');
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
  });

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

  // KAN-653. No quiet wait: the callout is not a dialog, so a key pressed
  // as the popup opens is no reason to hold it back.
  test('a key pressed as the popup opens does not stop it', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: holder({}),
    });
    fireEvent.keyDown(document.body, { key: 'Shift' });
    await waitFor(() =>
      expect(store.getState().globalState.isFullViewCalloutOpen).toBe(true)
    );
  });

  test('never on an open that showed a dialog', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
      seedStore: holder({}),
    });
    await waitFor(() =>
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
    );
    expect(store.getState().globalState.isFullViewCalloutOpen).toBe(false);
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('tabGroups')
    );
  });

  test('a check that throws before it returns stands down; the next opens, and the queue says so', async () => {
    tabGroupsOffer.throws = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The offer is due, so only the throw keeps it from winning.
    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
      seedStore: holder({}),
    });
    await waitFor(() =>
      expect(store.getState().globalState.isFullViewCalloutOpen).toBe(true)
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('fullViewCallout')
    );
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Could not decide the tabGroups dialog:',
      expect.any(Error)
    );
    warn.mockRestore();
  });
});
