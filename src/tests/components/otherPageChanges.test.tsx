import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Firebase is stubbed so App can mount; the consent test below needs sign-in
// to be something it can see being reached for.
const mocks = vi.hoisted(() => {
  // A cloud that holds what was last written to it. The consent test seeds it
  // with a session only device B has, so the sync it expects is a real merge
  // and not an echo of this device.
  const cloud: { doc: unknown } = { doc: undefined };
  return {
    cloud,
    ensureCloudSession: vi.fn(),
    loadFromFirestore: vi.fn(async (): Promise<unknown> => cloud.doc),
    saveToFirestore: vi.fn(
      async (_userId: string, data: unknown): Promise<void> => {
        cloud.doc = structuredClone(data);
      }
    ),
  };
});
vi.mock('../../config/firebase', () => ({
  ensureCloudSession: mocks.ensureCloudSession,
  observeAuthState: vi.fn(),
  signInUserAnonymously: () => {},
  isCloudConfigured: true,
}));
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  ensureCloudSessionReady: vi.fn(async () => {
    mocks.ensureCloudSession();
  }),
  displayToast: vi.fn(),
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';

// KAN-279 D9. Another open page (the popup, or the pop-out tab) wrote
// tabContainerData or settingsData. The browser fires a `storage` event in
// every OTHER page of the origin; this page takes the change in without a
// reload. The thunks it runs are tested at store level
// (src/tests/redux/otherPageChanges.test.ts); this file is the wiring.

const DAY = 24 * 60 * 60 * 1000;
const SYNC_STARTED = 'global/syncStateWithFirestore/pending';

const replaceSettings = settingsDataStateSlice.actions.replaceState;

// Store first, then localStorage: the slice's replaceState writes the
// PREVIOUS state to localStorage (see cloudConsent.test.tsx).
const seedSettings =
  (partial: Partial<SettingsData>) =>
  (s: { dispatch: (a: unknown) => void }) => {
    s.dispatch(replaceSettings({ ...settingsInitial, ...partial }));
    localStorage.setItem('settingsData', JSON.stringify(partial));
  };

// A user who has answered every first-open question, so no modal takes the
// screen: installed a month ago, cloud question answered.
const ANSWERED: Partial<SettingsData> = {
  extensionInstalledTime: Date.now() - 30 * DAY,
  cloudConsent: 'declined',
  isAutoSync: false,
};

// What the other page does: write the key (its store's saveToLocalStorage),
// then the browser tells this page. jsdom does not fire `storage` for its own
// writes, as no browser does for the writing page, so the test fires it.
const otherPageWrites = (key: string, value: unknown) => {
  const newValue = JSON.stringify(value);
  localStorage.setItem(key, newValue);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  });
};

const fireStorage = (init: StorageEventInit) =>
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', init));
  });

const session = (id: string, extra: Parameters<typeof buildSession>[0] = {}) =>
  buildSession({ tabGroupId: id, title: id, ...extra });

const withSelected = (
  sessions: ReturnType<typeof session>[],
  selectedId: string
): TabMasterContainer => ({
  ...buildContainer(
    sessions.map((s) => ({ ...s, isSelected: s.tabGroupId === selectedId }))
  ),
  selectedTabGroupId: selectedId,
});

// App's startup reads the container from localStorage (its local branch).
const renderApp = async (
  container: TabMasterContainer,
  settings: Partial<SettingsData> = ANSWERED
) => {
  localStorage.setItem('tabContainerData', JSON.stringify(container));
  const rendered = await renderWithProviders(<App />, {
    seedStore: seedSettings(settings),
  });
  // Mount has settled: the stored sessions are on screen, and the startup
  // effects' async reads (tab-groups permission) have landed.
  await screen.findAllByText(container.tabGroups[0].title);
  await act(async () => {});
  return rendered;
};

beforeEach(() => {
  localStorage.clear();
  mocks.cloud.doc = undefined;
  mocks.ensureCloudSession.mockReset();
  mocks.loadFromFirestore.mockClear();
  mocks.saveToFirestore.mockClear();
});
afterEach(async () => {
  // Unmount before putting the language back: a change with App still
  // mounted re-renders it outside act.
  cleanup();
  localStorage.clear();
  await testI18n.changeLanguage('en');
});

describe('a write in another page reaches this one (KAN-279 D9)', () => {
  test('a session saved in another page appears here', async () => {
    const { store } = await renderApp(buildContainer([session('Research')]));
    expect(screen.queryByText('Holiday')).toBeNull();

    otherPageWrites(
      'tabContainerData',
      buildContainer([session('Holiday'), session('Research')])
    );

    expect(await screen.findByText('Holiday')).toBeTruthy();
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['Holiday', 'Research']);
  });

  test('a language chosen in another page switches this one', async () => {
    const { store } = await renderApp(buildContainer([session('Research')]));
    expect(testI18n.language).toBe('en');

    otherPageWrites('settingsData', {
      ...store.getState().settingsDataState,
      language: 'de',
    });

    await waitFor(() => expect(testI18n.language).toBe('de'));
    expect(store.getState().settingsDataState.language).toBe('de');
  });
});

describe('events that carry nothing to take in (KAN-279 D9)', () => {
  // A real clear() or removeItem leaves nothing to read. Here a changed
  // container is left in place, so an event that was NOT ignored would visibly
  // hydrate it: "nothing dispatched" then means ignored, not "read nothing".
  const changedContainerIsStored = () =>
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([session('Holiday'), session('Research')]))
    );

  test('a clear() (key null) dispatches nothing', async () => {
    const { seen } = await renderApp(buildContainer([session('Research')]));
    changedContainerIsStored();
    seen.length = 0;

    fireStorage({ key: null, newValue: null });
    await act(async () => {});

    expect(seen).toEqual([]);
    expect(screen.queryByText('Holiday')).toBeNull();
  });

  test('a removeItem (newValue null) dispatches nothing, for either key', async () => {
    const { seen } = await renderApp(buildContainer([session('Research')]));
    changedContainerIsStored();
    seen.length = 0;

    fireStorage({ key: 'tabContainerData', newValue: null });
    fireStorage({ key: 'settingsData', newValue: null });
    await act(async () => {});

    expect(seen).toEqual([]);
    expect(screen.queryByText('Holiday')).toBeNull();
  });

  test('after unmount, an event dispatches nothing', async () => {
    const { seen, unmount } = await renderApp(
      buildContainer([session('Research')])
    );
    unmount();
    seen.length = 0;

    otherPageWrites(
      'tabContainerData',
      buildContainer([session('Holiday'), session('Research')])
    );
    await act(async () => {});

    expect(seen).toEqual([]);
  });
});

describe('the rename editor when its session goes (KAN-279 D9)', () => {
  test('the other page deleted the session being renamed: no rename field is left', async () => {
    const user = userEvent.setup();
    await renderApp(
      withSelected([session('Doomed'), session('Kept')], 'Doomed')
    );

    await user.click(
      screen.getByRole('button', { name: 'Rename session: Doomed' })
    );
    // The search box is a textbox too; the rename field is the one holding
    // the draft.
    expect(screen.getByDisplayValue('Doomed')).toBeTruthy();

    otherPageWrites('tabContainerData', buildContainer([session('Kept')]));

    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull());
    expect(screen.queryByDisplayValue('Doomed')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^Rename session/ })
    ).toBeNull();
  });
});

// Spec, "Consent and Auto Sync follow along": they are settings, so a
// hydration carries them, and App's startup effect depends on syncAllowed.
describe('consent across pages (KAN-279 D9)', () => {
  test('granted in another page: this page syncs exactly once; declined again: not at all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Device B saved a session this device lacks.
      mocks.cloud.doc = buildContainer([
        session('from-b', { lastModified: Date.now() }),
      ]);
      const settings: Partial<SettingsData> = {
        ...ANSWERED,
        cloudConsent: 'declined',
        isAutoSync: true,
      };
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(buildContainer([session('mine')]))
      );
      const { store, seen } = await renderWithProviders(<App />, {
        seedStore: (s) => {
          seedSettings(settings)(s);
          s.dispatch(setSignedIn());
          s.dispatch(setUserId('uuid-1'));
          s.dispatch(setFirebaseAuthed());
        },
      });
      await screen.findByText('mine');
      await act(async () => {});
      // Declined: signed in and authed, but nothing synced at startup.
      expect(seen).not.toContain(SYNC_STARTED);
      seen.length = 0;

      otherPageWrites('settingsData', {
        ...store.getState().settingsDataState,
        cloudConsent: 'granted',
      });
      await waitFor(() =>
        expect(store.getState().globalState.syncStatus).toBe('success')
      );
      // Anything the sync itself queued has had its window to fire.
      await act(async () => {
        vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);
      });
      await act(async () => {});

      expect(seen.filter((t) => t === SYNC_STARTED)).toHaveLength(1);
      // A real two-device merge: B's session came in.
      expect(
        store
          .getState()
          .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
          .sort()
      ).toEqual(['from-b', 'mine']);

      seen.length = 0;
      otherPageWrites('settingsData', {
        ...store.getState().settingsDataState,
        cloudConsent: 'declined',
      });
      await act(async () => {
        vi.advanceTimersByTime(DEBOUNCE_TIME_WINDOW + 1);
      });
      await act(async () => {});

      // The event was taken in (so "no sync" is not a missed event)...
      expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
      // ...and nothing synced.
      expect(seen).not.toContain(SYNC_STARTED);
    } finally {
      vi.useRealTimers();
    }
  });
});
