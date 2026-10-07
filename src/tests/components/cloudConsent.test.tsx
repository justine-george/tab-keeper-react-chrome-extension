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
  observeAuthState: vi.fn(),
  signInUserAnonymously: () => {},
  isCloudConfigured: true,
}));
// The manual starters reach the wait through the sync thunk, which talks to
// Firebase only via utils/functions/external (KAN-259). As the real one does:
// starts the session, then resolves.
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  ensureCloudSessionReady: vi.fn(async () => {
    mocks.ensureCloudSession();
  }),
  displayToast: vi.fn(),
}));

import App from '../../App';
import { CloudConsentModal } from '../../components/modals/CloudConsentModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { RUN_FINISHED_SETTINGS } from '../fixtures/firstRunFixture';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { newRun } from '../../utils/functions/firstRun';
import { RUN_LOCK } from '../../utils/functions/tourLock';
import {
  openCloudConsentModal,
  setIsDirty,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';
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

// The welcome's opening holds the run's lock.
let locks: FakeLocks;
beforeEach(() => {
  localStorage.clear();
  mocks.ensureCloudSession.mockReset();
  locks = installFakeLocks();
});
afterEach(() => {
  locks.uninstall();
  localStorage.clear();
});

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

  // KAN-410. The worst path: "currently synced" was untrue, and its Esc granted.
  test('an install date with no sessions and no past sync is welcomed, not told it is synced', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: '',
      isAutoSync: true,
    });
    const { store } = await renderWithProviders(<App />, { seedStore: seed });
    expect(
      await screen.findByRole('dialog', { name: 'Welcome to Tab Keeper' })
    ).toBeTruthy();
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
  });

  test('an existing user who already turned Auto Sync off is not asked; they answered', async () => {
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      lastSyncedTime: Date.now() - DAY,
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
      ...RUN_FINISHED_SETTINGS,
    });
    const { store } = await renderWithProviders(<App />, { seedStore: seed });
    await waitFor(() => expect(mocks.ensureCloudSession).toHaveBeenCalled());
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    expect(consentModal()).toBeNull();
  });
});

describe('the answers (KAN-259)', () => {
  const renderExisting = () =>
    renderWithProviders(<CloudConsentModal />, {
      seedStore: (s) =>
        s.dispatch(openCloudConsentModal({ variant: 'existing' })),
    });

  test('existing: Turn off sync declines; Keep sync on grants; Escape declines', async () => {
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
    const cancel = new Event('cancel', { bubbles: false, cancelable: true });
    fireEvent(c.container.querySelector('dialog')!, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    // Justine 2026-10-04: no upload without an explicit click (KAN-410).
    expect(c.store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(c.store.getState().settingsDataState.isAutoSync).toBe(false);
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

// KAN-410. The welcome asks nothing: it says what Tab Keeper does and moves on.
// Opening it records the device as local-only and starts onboarding, so a
// popup closed unanswered loses nothing and is never taken for an existing user.
describe('the welcome (KAN-410)', () => {
  const freshWelcome = async (
    seedStore?: (s: { dispatch: (a: unknown) => void }) => void
  ) => {
    const rendered = await renderWithProviders(<App />, { seedStore });
    const dialog = await screen.findByRole('dialog', {
      name: 'Welcome to Tab Keeper',
    });
    return { ...rendered, dialog };
  };

  test('the mark and title, the still hero, one line, the hint, Stay here and Get started; no sync wording', async () => {
    const { dialog } = await freshWelcome();
    const title = within(dialog).getByRole('heading', { level: 2 });
    expect(title).toHaveTextContent(/^Welcome to Tab Keeper$/);
    // The coloured header mark, not a Material glyph.
    expect(title.querySelector('svg')?.getAttribute('viewBox')).toBe(
      '0 0 128 128'
    );
    expect(title.querySelector('.material-symbols-outlined')).toBeNull();
    // The drawing is hidden from assistive tech; only Play again is not (KAN-464).
    expect(
      dialog
        .querySelector('[data-hero-part="floppy"]')
        ?.closest('[aria-hidden]')
    ).toHaveAttribute('aria-hidden', 'true');
    expect(dialog).toHaveAccessibleDescription(
      'Save your open windows, close them, and bring them all back later.'
    );
    expect(dialog).toHaveTextContent(
      'Get started opens Tab Keeper in its own tab.'
    );
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Stay here', 'Get started']);
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(dialog.textContent).not.toMatch(/sync|privacy|device|cloud/i);
    // Opens unlit (KAN-243).
    expect(document.activeElement).toBe(dialog);
  });

  test('opening it records local-only and onboarding started, on disk too, and touches no Firebase', async () => {
    const { store } = await freshWelcome();
    expect(store.getState().settingsDataState).toMatchObject({
      cloudConsent: 'declined',
      isAutoSync: false,
      setupState: 'pending',
    });
    // What the next open reads.
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({
      cloudConsent: 'declined',
      isAutoSync: false,
      setupState: 'pending',
    });
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
  });

  test('opening it records the popup run at the welcome, counted once (Q7)', async () => {
    const { store } = await freshWelcome();
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(
        newRun('popup', 0)
      )
    );
    expect(store.getState().globalState.isRunHere).toBe(true);
  });

  test('Stay here closes it and the popup run starts at its save card', async () => {
    const user = userEvent.setup();
    const { store, dialog } = await freshWelcome();
    await user.click(within(dialog).getByRole('button', { name: 'Stay here' }));
    expect(
      screen.queryByRole('dialog', { name: 'Welcome to Tab Keeper' })
    ).toBeNull();
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(
        newRun('popup', 1)
      )
    );
  });

  test('Esc is Stay here, and is consumed (KAN-403, KAN-426)', async () => {
    const { store, dialog } = await freshWelcome();
    const notPrevented = fireEvent(
      dialog,
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    expect(notPrevented).toBe(false);
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(
        newRun('popup', 1)
      )
    );
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
  });

  test('Get started lets the lock go, then records the full-view run at step 1 (no Hello), then asks for the full view (Review Focus 1)', async () => {
    const user = userEvent.setup();
    const { store, dialog, chrome } = await freshWelcome();
    await waitFor(() => expect(locks.held.has(RUN_LOCK)).toBe(true));
    let heldAtRecord: boolean | null = null;
    store.subscribe(() => {
      if (
        heldAtRecord === null &&
        store.getState().settingsDataState.firstRun?.view === 'full'
      ) {
        heldAtRecord = locks.held.has(RUN_LOCK);
      }
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Get started' })
    );
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(
        newRun('full', 1)
      )
    );
    expect(heldAtRecord).toBe(false);
    await waitFor(() =>
      expect(chrome.sentMessages).toContainEqual(
        expect.objectContaining({ type: 'openInTab' })
      )
    );
    expect(store.getState().globalState.isRunHere).toBe(false);
  });

  test('after it, the sync button asks the full question first, and only its Sync starts Firebase', async () => {
    const user = userEvent.setup();
    const { store, dialog } = await freshWelcome((s) => {
      s.dispatch(setSignedIn());
      s.dispatch(setUserId('uuid-1'));
    });
    await user.click(within(dialog).getByRole('button', { name: 'Stay here' }));
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(
        newRun('popup', 1)
      )
    );

    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    const ask = screen.getByRole('dialog', {
      name: 'Sync your sessions across devices?',
    });
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
    await user.click(within(ask).getByRole('button', { name: 'Sync' }));
    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
    await waitFor(() => expect(mocks.ensureCloudSession).toHaveBeenCalled());
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
      ...RUN_FINISHED_SETTINGS,
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
      ...RUN_FINISHED_SETTINGS,
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
    // One sync, not a setting: Auto Sync stays off (Justine's case).
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    await waitFor(() => expect(mocks.ensureCloudSession).toHaveBeenCalled());
  });

  test('Escape on the plain question is Not now', async () => {
    const { container, store } = await renderWithProviders(
      <CloudConsentModal />,
      {
        seedStore: (s) => {
          s.dispatch(declineCloudConsent());
          s.dispatch(
            openCloudConsentModal({ variant: 'enable', then: 'syncNow' })
          );
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

// The sequence Justine asked about: an existing, syncing user opens the
// popup, is asked, presses Turn off sync, then edits. Nothing may sync at any
// point -- not while the dialog is up (consent is still unanswered), not on
// the answer, and not on the edit -- and Firebase is never contacted.
describe('Turn off sync means no sync, before and after (KAN-259)', () => {
  test('existing user: nothing syncs while asked, on Turn off sync, or on a later edit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      lastSyncedTime: Date.now() - DAY,
      isAutoSync: true,
    });
    const { store, seen } = await renderWithProviders(<App />, {
      seedStore: (s) => {
        seed(s);
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
      },
    });
    const dialog = await screen.findByRole('dialog', {
      name: 'Your sessions are currently synced',
    });
    // While the question is up: no sign-in, no sync thunk.
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
    expect(seen).not.toContain('global/syncStateWithFirestore/pending');

    await user.click(
      within(dialog).getByRole('button', { name: 'Turn off sync' })
    );
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');

    // An edit afterwards: the middleware would debounce a sync if allowed.
    seen.length = 0;
    act(() => {
      store.dispatch(setIsDirty());
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);
    });
    expect(seen).not.toContain('global/syncStateWithFirestore/pending');
    expect(mocks.ensureCloudSession).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// Justine's case: declined, then the cloud button, then Sync. That is a
// request for ONE sync. Consent is granted (they said yes to the cloud) and
// the sync runs, but Auto Sync stays as it was -- they never asked for it.
// The same question from the Auto Sync toggle turns it on, because that is
// what they were doing there.
describe('the plain question does what it was opened for (KAN-259)', () => {
  test('from the cloud button, Sync syncs once and leaves Auto Sync off', async () => {
    const user = userEvent.setup();
    const seed = seedSettings({
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    const { store, seen } = await renderWithProviders(<App />, {
      seedStore: (s) => {
        seed(s);
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
      },
    });
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Sync your sessions across devices?',
    });
    // The fine print says so.
    expect(dialog.textContent).toMatch(/Auto Sync stays off/);
    seen.length = 0;
    await user.click(within(dialog).getByRole('button', { name: 'Sync' }));

    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    await waitFor(() => expect(mocks.ensureCloudSession).toHaveBeenCalled());
    expect(seen).toContain('global/syncStateWithFirestore/pending');
  });

  test('from the Auto Sync toggle, Sync turns Auto Sync on', async () => {
    const { store } = await renderWithProviders(<CloudConsentModal />, {
      seedStore: (s) => {
        s.dispatch(declineCloudConsent());
        s.dispatch(
          openCloudConsentModal({ variant: 'enable', then: 'autoSync' })
        );
      },
    });
    const user = userEvent.setup();
    const dialog = screen.getByRole('dialog', {
      name: 'Sync your sessions across devices?',
    });
    expect(dialog.textContent).not.toMatch(/Auto Sync stays off/);
    await user.click(within(dialog).getByRole('button', { name: 'Sync' }));
    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
  });
});
