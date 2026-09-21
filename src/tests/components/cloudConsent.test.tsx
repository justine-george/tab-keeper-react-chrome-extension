import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Firebase is stubbed so the test can SEE whether App reached for it: the
// whole point of lazy sign-in is that an unconsented user never does.
const mocks = vi.hoisted(() => ({
  ensureCloudSession: vi.fn(),
}));
vi.mock('../../config/firebase', () => ({
  ensureCloudSession: mocks.ensureCloudSession,
  ensureCloudSessionReady: vi.fn(async () => undefined),
  observeAuthState: vi.fn(),
  signInUserAnonymously: () => {},
  isCloudConfigured: true,
}));

import App from '../../App';
import { CloudConsentModal } from '../../components/modals/CloudConsentModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  openCloudConsentModal,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
  declineCloudConsent,
  toggleAutoSync,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';

// replaceState is a reducer the slice does not export by name.
const replaceSettings = settingsDataStateSlice.actions.replaceState;

// The settings slice hydrates from localStorage at MODULE load, so a value
// written by a test is not in the store; App reads localStorage directly for
// its first-open decisions, the store for its sync gate. Seed both.
//
// The store first: the slice's replaceState writes the PREVIOUS state to
// localStorage before returning the new one (no production caller, so it
// has never mattered), which would overwrite the seed if written first.
const seedSettings =
  (partial: Partial<SettingsData>) =>
  (s: { dispatch: (a: unknown) => void }) => {
    s.dispatch(replaceSettings({ ...settingsInitial, ...partial }));
    localStorage.setItem('settingsData', JSON.stringify(partial));
  };

// KAN-259. Auto Sync defaulted on, so a new user's first save uploaded URLs
// and titles -- browsing activity -- before any choice was shown, and
// anonymous Firebase sign-in ran on every popup open, consented or not.
//
// Now: nothing leaves the device, and Firebase is not contacted, until the
// user answers a one-screen welcome. An existing user gets the same screen
// once, phrased for someone whose sessions are already synced. Both are shown
// before the rate prompt and the tab-groups offer, which wait.

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  mocks.ensureCloudSession.mockReset();
});
afterEach(() => localStorage.clear());

const consentModal = () =>
  screen.queryByRole('dialog', {
    name: /Welcome to Tab Keeper|currently synced/,
  });

describe('who is asked, and which screen (KAN-259)', () => {
  test('a fresh install gets the welcome before anything else, and Firebase is not touched', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: { tabs: [{ groupId: 11 }, { groupId: 12 }, { groupId: -1 }] },
    });

    await waitFor(() =>
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true)
    );
    expect(
      screen.getByRole('dialog', { name: 'Welcome to Tab Keeper' })
    ).toBeTruthy();
    // The other first-open modals stood down.
    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
    // Lazy sign-in: no answer yet, so no Firebase.
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
  });

  test('an existing user with sessions gets the "currently synced" screen', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
    });
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([buildSession()]))
    );
    await renderWithProviders(<App />, { seedStore: seed });
    expect(
      await screen.findByRole('dialog', {
        name: 'Your sessions are currently synced',
      })
    ).toBeTruthy();
  });

  test('an existing user who already turned Auto Sync off is not asked; they answered', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      isAutoSync: false,
    });
    const { store } = await renderWithProviders(<App />, { seedStore: seed });
    await waitFor(() =>
      expect(store.getState().settingsDataState.cloudConsent).toBe('declined')
    );
    expect(consentModal()).toBeNull();
  });

  test('a user who has answered is not asked again', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: 'granted',
    });
    const { store } = await renderWithProviders(<App />, { seedStore: seed });
    await waitFor(() => expect(mocks.ensureCloudSession).toHaveBeenCalled());
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    expect(consentModal()).toBeNull();
  });
});

describe('the answers (KAN-259)', () => {
  const renderWelcome = () =>
    renderWithProviders(<CloudConsentModal />, {
      seedStore: (s) => s.dispatch(openCloudConsentModal('welcome')),
    });
  const renderExisting = () =>
    renderWithProviders(<CloudConsentModal />, {
      seedStore: (s) => s.dispatch(openCloudConsentModal('existing')),
    });

  test('welcome: Keep on this device declines and turns Auto Sync off', async () => {
    const user = userEvent.setup();
    const { store } = await renderWelcome();
    const dialog = screen.getByRole('dialog', {
      name: 'Welcome to Tab Keeper',
    });
    // Opens unlit (KAN-243): the dialog holds the focus, no button is
    // pre-chosen. Escape is still the answer that changes nothing.
    expect(document.activeElement).toBe(dialog);
    await user.click(
      within(dialog).getByRole('button', { name: 'Keep on this device' })
    );
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
  });

  test('welcome: Sync across devices grants and turns Auto Sync on', async () => {
    const user = userEvent.setup();
    const { store } = await renderWelcome();
    await user.click(
      screen.getByRole('button', { name: 'Sync across devices' })
    );
    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
  });

  test('welcome: Escape means keep on this device', async () => {
    const { container, store } = await renderWelcome();
    fireEvent(
      container.querySelector('dialog')!,
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
  });

  test('existing: Turn off sync declines; Keep sync on grants; Escape keeps', async () => {
    const user = userEvent.setup();
    const a = await renderExisting();
    const dialog = screen.getByRole('dialog', {
      name: 'Your sessions are currently synced',
    });
    // Opens unlit: no button pre-chosen -- in particular not Turn off sync,
    // a settings change one accidental Enter away.
    expect(document.activeElement).toBe(dialog);
    await user.click(
      within(dialog).getByRole('button', { name: 'Turn off sync' })
    );
    expect(a.store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(a.store.getState().settingsDataState.isAutoSync).toBe(false);
    a.unmount();

    const b = await renderExisting();
    await user.click(screen.getByRole('button', { name: 'Keep sync on' }));
    expect(b.store.getState().settingsDataState.cloudConsent).toBe('granted');
    expect(b.store.getState().settingsDataState.isAutoSync).toBe(true);
    b.unmount();

    const c = await renderExisting();
    fireEvent(
      c.container.querySelector('dialog')!,
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    // "Do nothing" must not change a setting they had.
    expect(c.store.getState().settingsDataState.cloudConsent).toBe('granted');
    expect(c.store.getState().settingsDataState.isAutoSync).toBe(true);
  });

  test('granting from the welcome is what starts Firebase', async () => {
    const user = userEvent.setup();
    const { store } = await renderWithProviders(<App />);
    await waitFor(() =>
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true)
    );
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Sync across devices' })
    );
    await waitFor(() =>
      expect(mocks.ensureCloudSession).toHaveBeenCalledTimes(1)
    );
  });

  test('turning Auto Sync on later, after declining, asks again rather than uploading', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    const { store } = await renderWithProviders(<App />, { seedStore: seed });
    expect(consentModal()).toBeNull();
    act(() => {
      store.dispatch(toggleAutoSync());
    });
    // The reducer flips the flag; what must not happen is a sync. The
    // effective permission is consent AND the flag, and consent is still no.
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
  });
});

// The rows of "when does it open" -- each one a way the dialog must NOT be
// a surprise. Once answered on a device it is never asked at popup open
// again; the only way back is asking for the cloud after declining, and then
// it is the plain question, not a greeting.
describe('it is never a surprise (KAN-259)', () => {
  test('granted: turning Auto Sync off and on again asks nothing', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: 'granted',
    });
    const { store } = await renderWithProviders(<App />, { seedStore: seed });
    act(() => {
      store.dispatch(toggleAutoSync());
    });
    act(() => {
      store.dispatch(toggleAutoSync());
    });
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
  });

  test('declined, then the sync button: the plain question, not the welcome, and Not now changes nothing', async () => {
    const user = userEvent.setup();
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    const { store } = await renderWithProviders(<App />, {
      seedStore: (s) => {
        seed(s);
        s.dispatch(setSignedIn());
      },
    });
    expect(consentModal()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Sync your sessions across devices?',
    });
    expect(screen.queryByText('Welcome to Tab Keeper')).toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
  });

  test('declined, then the sync button, then Sync: granted, and Firebase starts', async () => {
    const user = userEvent.setup();
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    const { store } = await renderWithProviders(<App />, {
      seedStore: (s) => {
        seed(s);
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
      },
    });
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    await user.click(screen.getByRole('button', { name: 'Sync' }));
    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
    await waitFor(() => expect(mocks.ensureCloudSession).toHaveBeenCalled());
  });

  test('Escape on the plain question is Not now', async () => {
    const { container, store } = await renderWithProviders(
      <CloudConsentModal />,
      {
        seedStore: (s) => {
          s.dispatch(declineCloudConsent());
          s.dispatch(openCloudConsentModal('enable'));
        },
      }
    );
    fireEvent(
      container.querySelector('dialog')!,
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
  });
});
