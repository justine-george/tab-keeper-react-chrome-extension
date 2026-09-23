import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';

// Firebase is stubbed so App can mount. Sign-in never lands here: the startup
// effect keeps taking its local branch, which is the route under test.
vi.mock('../../config/firebase', () => ({
  ensureCloudSession: vi.fn(),
  observeAuthState: vi.fn(),
  signInUserAnonymously: () => {},
  isCloudConfigured: true,
}));
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  ensureCloudSessionReady: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { setSignedIn, setUserId } from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { TAB_CONTAINER_REPLACE_STATE_ACTION } from '../../utils/constants/actionTypes';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// KAN-295, through App. Its startup effect re-runs its local branch when a
// hydrated settings change flips `syncAllowed` (auth not landed yet), and that
// branch loads the container from localStorage. If another page wrote there
// and this page has not taken it in yet, the load is a change this page did
// not make: an undo must not reverse it (D12), so history resets, as the
// storage-event hydrate would have reset it.

const DAY = 24 * 60 * 60 * 1000;

type Store = Awaited<ReturnType<typeof renderWithProviders>>['store'];

const replaceSettings = settingsDataStateSlice.actions.replaceState;

// Store first, then localStorage: the slice's replaceState writes the
// PREVIOUS state to localStorage (see cloudConsent.test.tsx).
const seedSettings =
  (partial: Partial<SettingsData>) =>
  (s: { dispatch: (a: unknown) => void }) => {
    s.dispatch(replaceSettings({ ...settingsInitial, ...partial }));
    localStorage.setItem('settingsData', JSON.stringify(partial));
  };

const readStored = (): TabMasterContainer => {
  const data = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(data)) {
    throw new Error('tabContainerData in localStorage is not a container');
  }
  return data;
};

// Signed in with a document id, cloud allowed but Auto Sync off: the startup
// effect takes its local branch on mount, this page's first load.
const openApp = async () => {
  localStorage.setItem(
    'tabContainerData',
    JSON.stringify(
      buildContainer([
        buildSession({ tabGroupId: 'alpha', title: 'Alpha' }),
        buildSession({ tabGroupId: 'bravo', title: 'Bravo' }),
      ])
    )
  );
  const rendered = await renderWithProviders(<App />, {
    seedStore: (s) => {
      seedSettings({
        extensionInstalledTime: Date.now() - 30 * DAY,
        cloudConsent: 'granted',
        isAutoSync: false,
      })(s);
      s.dispatch(setSignedIn());
      s.dispatch(setUserId('uuid-1'));
    },
  });
  await screen.findAllByText('Alpha');
  await act(async () => {});
  return rendered;
};

const titleOf = (store: Store, id: string) =>
  store
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id)?.title;

// Another open page, a real store on the same localStorage, renames alpha.
// jsdom fires no storage event for it, so this page has not heard of it --
// as when the event is queued behind a drag, or not yet delivered.
const otherPageRenamesAlpha = () => {
  const other = makeTestStore().store;
  other.dispatch(replaceState(readStored()));
  other.dispatch(
    updateTabGroupTitle({ tabGroupId: 'alpha', editableTitle: 'Other page' })
  );
};

// The other page turns Auto Sync on: its settings write reaches this page,
// whose startup effect re-runs its local branch (auth has not landed).
const otherPageTurnsAutoSyncOn = (store: Store) => {
  const newValue = JSON.stringify({
    ...store.getState().settingsDataState,
    isAutoSync: true,
  });
  localStorage.setItem('settingsData', newValue);
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'settingsData', newValue })
    );
  });
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("App's re-run of its local load (KAN-295)", () => {
  test("finding this page behind another page's write, it resets undo", async () => {
    const { store, seen } = await openApp();
    act(() => {
      store.dispatch(
        updateTabGroupTitle({ tabGroupId: 'bravo', editableTitle: 'Mine' })
      );
    });
    expect(store.getState().undoRedo.past.length).toBe(1);
    otherPageRenamesAlpha();

    seen.length = 0;
    otherPageTurnsAutoSyncOn(store);
    await act(async () => {});

    // The effect did re-run its local branch, and it loaded the write.
    expect(seen).toContain(TAB_CONTAINER_REPLACE_STATE_ACTION);
    expect({
      past: store.getState().undoRedo.past.length,
      alpha: titleOf(store, 'alpha'),
    }).toEqual({ past: 0, alpha: 'Other page' });
    act(() => {
      store.dispatch(undo());
    });
    expect(titleOf(store, 'alpha')).toBe('Other page');
  });

  test("CONTROL: level with localStorage, the re-run leaves this page's undo", async () => {
    const { store, seen } = await openApp();
    act(() => {
      store.dispatch(
        updateTabGroupTitle({ tabGroupId: 'bravo', editableTitle: 'Mine' })
      );
    });

    seen.length = 0;
    otherPageTurnsAutoSyncOn(store);
    await act(async () => {});

    expect(seen).toContain(TAB_CONTAINER_REPLACE_STATE_ACTION);
    expect(store.getState().undoRedo.past.length).toBe(1);
  });
});
