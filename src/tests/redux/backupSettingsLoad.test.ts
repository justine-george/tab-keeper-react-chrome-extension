// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Inlined rather than imported: common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
  saveToFirestore: vi.fn<(userId: string, data: unknown) => Promise<void>>(
    async () => undefined
  ),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
}));

import i18next from 'i18next';

import {
  loadSessionsFromBackup,
  mergeSessionsFromBackup,
  replaceSessionsFromBackup,
} from '../../redux/slices/globalStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import {
  grantCloudConsent,
  Language,
} from '../../redux/slices/settingsDataStateSlice';
import { loadBackupFile } from '../../redux/backupFile';
import { Theme } from '../../utils/constants/theme';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { DEFAULT_VIEW_KEY } from '../../utils/functions/defaultView';
import { TOOLBAR_ICON_KEY } from '../../utils/functions/toolbarIcon';
import type { BackupSettings } from '../../utils/functions/backupSettings';
import { makeTestStore } from '../setup/makeStore';
import { newestToast } from '../setup/toasts';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-961. A backup's settings apply into an empty Tab Keeper and on Replace, never on Merge.

const HERE = buildContainer([
  buildSession({ tabGroupId: 'h1', title: 'Here one' }),
]);
const FILE = buildContainer([
  buildSession({ tabGroupId: 'f1', title: 'From the file' }),
]);
const SETTINGS: BackupSettings = { theme: Theme.CHARCOAL };

let chromeFake: ReturnType<typeof setupChromeFake> | undefined;
let changeLanguage: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  chromeFake = setupChromeFake();
  changeLanguage = vi
    .spyOn(i18next, 'changeLanguage')
    .mockResolvedValue((() => '') as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  chromeFake?.restore();
  chromeFake = undefined;
});

const storeWith = (here: typeof HERE | null) => {
  const made = makeTestStore();
  if (here) made.store.dispatch(replaceState(here));
  return made;
};

describe('which loads apply a backup’s settings', () => {
  test('an empty Tab Keeper takes the file settings, no dialog', async () => {
    const { store } = storeWith(null);
    await store.dispatch(
      loadSessionsFromBackup({
        container: FILE,
        fileName: 'b.json',
        settings: SETTINGS,
      })
    );
    const state = store.getState();
    expect(state.settingsDataState.theme).toBe(Theme.CHARCOAL);
    expect(state.globalState.pendingImport).toBeNull();
    expect(newestToast(state)?.text).toBe(
      TOAST_MESSAGES.IMPORT_SETTINGS_SUCCESS
    );
  });

  test('Replace applies settings', async () => {
    const { store } = storeWith(HERE);
    await store.dispatch(
      loadSessionsFromBackup({
        container: FILE,
        fileName: 'b.json',
        settings: SETTINGS,
      })
    );
    expect(store.getState().globalState.pendingImport?.settings).toEqual(
      SETTINGS
    );
    expect(store.getState().settingsDataState.theme).toBe(Theme.LIGHT);

    await store.dispatch(
      replaceSessionsFromBackup({ container: FILE, settings: SETTINGS })
    );
    const state = store.getState();
    expect(state.settingsDataState.theme).toBe(Theme.CHARCOAL);
    expect(
      state.tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['f1']);
    expect(newestToast(state)?.text).toBe(
      TOAST_MESSAGES.IMPORT_SETTINGS_SUCCESS
    );
  });

  test('Merge leaves settings alone', async () => {
    const { store } = storeWith(HERE);
    await store.dispatch(
      loadSessionsFromBackup({
        container: FILE,
        fileName: 'b.json',
        settings: SETTINGS,
      })
    );
    await store.dispatch(mergeSessionsFromBackup(FILE));
    const state = store.getState();
    expect(state.settingsDataState.theme).toBe(Theme.LIGHT);
    expect(newestToast(state)?.text).toBe(TOAST_MESSAGES.IMPORT_SUCCESS);
  });

  test('Replace with unchanged sessions still applies settings', async () => {
    const { store } = storeWith(HERE);
    await store.dispatch(
      replaceSessionsFromBackup({ container: HERE, settings: SETTINGS })
    );
    const state = store.getState();
    expect(state.settingsDataState.theme).toBe(Theme.CHARCOAL);
    expect(newestToast(state)?.text).toBe(
      TOAST_MESSAGES.IMPORT_SETTINGS_SUCCESS
    );
  });

  test('an older backup (settings null) keeps settings and shows Tabs restored.', async () => {
    const { store } = storeWith(null);
    const before = store.getState().settingsDataState;
    await store.dispatch(
      loadSessionsFromBackup({
        container: FILE,
        fileName: 'b.json',
        settings: null,
      })
    );
    const state = store.getState();
    expect(state.settingsDataState).toEqual(before);
    expect(newestToast(state)?.text).toBe(TOAST_MESSAGES.IMPORT_SUCCESS);
  });

  test('a setting the file leaves out keeps this computer’s value', async () => {
    const { store } = storeWith(null);
    await store.dispatch(
      loadSessionsFromBackup({
        container: FILE,
        fileName: 'b.json',
        settings: { skipDuplicateTabs: true },
      })
    );
    const s = store.getState().settingsDataState;
    expect(s.skipDuplicateTabs).toBe(true);
    expect(s.theme).toBe(Theme.LIGHT);
  });
});

describe('how they apply', () => {
  test('applies language through i18n before the toast', async () => {
    const order: string[] = [];
    changeLanguage.mockImplementation(async (lng?: string) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push(`language ${String(lng)}`);
      return (() => '') as never;
    });
    const { store } = storeWith(null);
    store.subscribe(() => {
      const toast = newestToast(store.getState());
      if (toast && !order.includes('toast')) order.push('toast');
    });
    await store.dispatch(
      replaceSessionsFromBackup({
        container: FILE,
        settings: { language: Language.DE, timeFormat: 'h23' },
      })
    );
    expect(order).toEqual(['language de', 'toast']);
    const s = store.getState().settingsDataState;
    expect(s.language).toBe(Language.DE);
    expect(s.timeFormat).toBe('h23');
  });

  test('toolbar icon and default view are mirrored for the worker', async () => {
    const { store } = storeWith(null);
    await store.dispatch(
      replaceSessionsFromBackup({
        container: FILE,
        settings: { toolbarIcon: 'monochrome', defaultView: 'full' },
      })
    );
    expect(chromeFake?.localArea()).toMatchObject({
      [TOOLBAR_ICON_KEY]: 'monochrome',
      [DEFAULT_VIEW_KEY]: 'full',
    });
    expect(chromeFake?.popupsSet).toEqual(['']);
    const s = store.getState().settingsDataState;
    expect(s.toolbarIcon).toBe('monochrome');
    expect(s.defaultView).toBe('full');
  });

  test('every allow-listed setting lands in the store', async () => {
    const all: Required<BackupSettings> = {
      theme: Theme.CHARCOAL,
      language: Language.JA,
      timeFormat: 'h12',
      sessionDateBasis: 'created',
      exportLayout: 'comfortable',
      defaultView: 'full',
      toolbarIcon: 'monochrome',
      pinTabKeeperInNewWindows: true,
      defaultSaveScope: 'current-window',
      copyLinksLayout: 'with-headings',
      openSavedWindowsIn: 'this-window',
      skipDuplicateTabs: true,
      skipTabsAlreadyOpen: true,
      foldSavedSessionInTabView: false,
      foldOpenNowInTabView: true,
    };
    const { store } = storeWith(null);
    await store.dispatch(
      replaceSessionsFromBackup({ container: FILE, settings: all })
    );
    expect(store.getState().settingsDataState).toMatchObject(all);
  });

  test('sync failure keeps its own toast', async () => {
    mocks.saveToFirestore.mockRejectedValue(new Error('permission-denied'));
    const { store } = storeWith(null);
    store.dispatch(grantCloudConsent());
    await store.dispatch(
      replaceSessionsFromBackup({ container: FILE, settings: SETTINGS })
    );
    const state = store.getState();
    expect(state.settingsDataState.theme).toBe(Theme.CHARCOAL);
    expect(newestToast(state)?.text).toBe(TOAST_MESSAGES.IMPORT_SYNC_FAILED);
  });
});

describe('a file that never loads', () => {
  const pickFile = (text: string) => {
    const inputs: HTMLInputElement[] = [];
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      const el = real(tagName, options);
      if (el instanceof HTMLInputElement) {
        el.click = () => {};
        inputs.push(el);
      }
      return el;
    }) as typeof document.createElement);
    return () => {
      const input = inputs[0];
      Object.defineProperty(input, 'files', {
        value: [new File([text], 'b.json', { type: 'application/json' })],
      });
      input.onchange?.(new Event('change'));
    };
  };

  test('a refused file applies nothing', async () => {
    const { store } = storeWith(null);
    const before = store.getState().settingsDataState;
    const drop = pickFile(
      JSON.stringify({
        tabGroups: 'not a list',
        settings: { theme: 'Charcoal' },
      })
    );
    store.dispatch(
      loadBackupFile({ language: 'en', t: ((key: string) => key) as never })
    );
    drop();
    await vi.waitFor(() => expect(newestToast(store.getState())).toBeDefined());
    expect(store.getState().settingsDataState).toEqual(before);
    expect(store.getState().globalState.pendingImport).toBeNull();
  });
});
