import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';

// Firebase is stubbed so App can mount. Sign-in never lands by itself: a test
// that wants a sync dispatches setFirebaseAuthed, as observeAuthState would.
const mocks = vi.hoisted(() => {
  // Written by saveToFirestore; each test seeds what the other device saved.
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
import { TAB_CONTAINER_REPLACE_STATE_ACTION } from '../../utils/constants/actionTypes';

// KAN-294, through App. Its startup effect is both a first load (site 5, the
// local branch on mount) and the route into every later one: it re-runs its
// local branch whenever a hydrated settings change flips `syncAllowed`, and
// runs the sync once auth lands. Selection is per page (KAN-279 D9), so none
// of those later loads may take the other page's selection from localStorage.

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

// Every first-open question answered, and the cloud allowed. Auto Sync is
// each test's choice.
const answered = (isAutoSync: boolean): Partial<SettingsData> => ({
  extensionInstalledTime: Date.now() - 30 * DAY,
  cloudConsent: 'granted',
  isAutoSync,
});

const selecting = (
  container: TabMasterContainer,
  id: string | null
): TabMasterContainer => ({
  ...container,
  selectedTabGroupId: id,
  tabGroups: container.tabGroups.map((g) => ({
    ...g,
    isSelected: g.tabGroupId === id,
  })),
});

const stored = (selected: string) =>
  selecting(
    buildContainer([
      buildSession({ tabGroupId: 'alpha', title: 'Alpha' }),
      buildSession({ tabGroupId: 'bravo', title: 'Bravo' }),
    ]),
    selected
  );

// The other page writes the key, and the browser tells this page. For the
// sessions that is a hydrate the listener must ignore -- same data, only the
// selection differs -- so what reaches this page is the value on disk.
const otherPageWrites = (key: string, value: unknown) => {
  const newValue = JSON.stringify(value);
  localStorage.setItem(key, newValue);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  });
};

const shown = (store: Store) => {
  const { tabContainerDataState, undoRedo } = store.getState();
  const flags = (c: TabMasterContainer) =>
    c.tabGroups.filter((g) => g.isSelected).map((g) => g.tabGroupId);
  return {
    selected: tabContainerDataState.selectedTabGroupId,
    flagged: flags(tabContainerDataState),
    presentSelected: undoRedo.present.tabContainerDataState.selectedTabGroupId,
    presentFlagged: flags(undoRedo.present.tabContainerDataState),
  };
};

const keeps = (id: string) => ({
  selected: id,
  flagged: [id],
  presentSelected: id,
  presentFlagged: [id],
});

// Signed in with a document id, but auth has not landed: the startup effect
// takes its local branch on mount, which is this page's first load.
const openApp = async (selected: string, isAutoSync: boolean) => {
  localStorage.setItem('tabContainerData', JSON.stringify(stored(selected)));
  const rendered = await renderWithProviders(<App />, {
    seedStore: (s) => {
      seedSettings(answered(isAutoSync))(s);
      s.dispatch(setSignedIn());
      s.dispatch(setUserId('uuid-1'));
    },
  });
  await screen.findAllByText('Alpha');
  await act(async () => {});
  return rendered;
};

const authLands = async (store: Store) => {
  act(() => {
    store.dispatch(setFirebaseAuthed());
  });
  await waitFor(() =>
    expect(store.getState().globalState.syncStatus).toBe('success')
  );
  await act(async () => {});
};

beforeEach(() => {
  localStorage.clear();
  mocks.cloud.doc = undefined;
  mocks.ensureCloudSession.mockReset();
  mocks.loadFromFirestore.mockClear();
  mocks.saveToFirestore.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("App's loads keep this page's own selection (KAN-294)", () => {
  test('site 5: Auto Sync flipped on and off in another page re-runs the local load, and alpha stays', async () => {
    const { store, seen } = await openApp('alpha', false);
    expect(shown(store)).toEqual(keeps('alpha'));
    otherPageWrites('tabContainerData', stored('bravo'));
    // CONTROL: the listener ignored it (same data), so any move to bravo
    // below came through the load.
    expect(shown(store)).toEqual(keeps('alpha'));

    seen.length = 0;
    otherPageWrites('settingsData', {
      ...store.getState().settingsDataState,
      isAutoSync: true,
    });
    await act(async () => {});
    // The effect did re-run its local branch (auth has not landed).
    expect(seen).toContain(TAB_CONTAINER_REPLACE_STATE_ACTION);
    expect(shown(store)).toEqual(keeps('alpha'));

    seen.length = 0;
    otherPageWrites('settingsData', {
      ...store.getState().settingsDataState,
      isAutoSync: false,
    });
    await act(async () => {});
    expect(seen).toContain(TAB_CONTAINER_REPLACE_STATE_ACTION);
    expect(shown(store)).toEqual(keeps('alpha'));
  });

  // The sites below run with hasSyncedBefore still false, so each sets the
  // undo `present` through setPresentStartup: that must get the same
  // selection the store gets.
  test('site 1: the startup sync (a merge that changed nothing) keeps alpha, in undo too', async () => {
    const { store } = await openApp('alpha', true);
    mocks.cloud.doc = stored('bravo');
    otherPageWrites('tabContainerData', stored('bravo'));

    await authLands(store);

    expect(shown(store)).toEqual(keeps('alpha'));
  });

  test('site 2: the startup sync, cloud only, keeps alpha, in undo too', async () => {
    const { store } = await openApp('alpha', true);
    mocks.cloud.doc = stored('bravo');
    localStorage.removeItem('tabContainerData');

    await authLands(store);

    expect(shown(store)).toEqual(keeps('alpha'));
  });

  test('site 3: the startup sync, local only (no document yet), keeps alpha, in undo too', async () => {
    const { store } = await openApp('alpha', true);
    otherPageWrites('tabContainerData', stored('bravo'));

    await authLands(store);

    expect(mocks.saveToFirestore).toHaveBeenCalled();
    expect(shown(store)).toEqual(keeps('alpha'));
  });
});

describe('a lone page is unaffected (KAN-294)', () => {
  test('CONTROL: a lone page opens, loads, syncs, and keeps the stored selection', async () => {
    const { store } = await openApp('bravo', true);
    expect(shown(store)).toEqual(keeps('bravo'));
    mocks.cloud.doc = stored('alpha');

    await authLands(store);

    expect(shown(store)).toEqual(keeps('bravo'));
  });
});
