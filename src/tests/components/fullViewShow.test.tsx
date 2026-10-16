import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

// These tests pin which dialog an open picks, not when.
vi.mock('../../utils/constants/cardDelay', () => ({ CARD_DELAY_MS: 0 }));

vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  ensureCloudSession: () => {},
  isCloudConfigured: false,
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import { makeTestStore } from '../setup/makeStore';
import { takeShowFromAddress } from '../../utils/functions/fullViewShow';
import { showInFullView } from '../../redux/fullViewShow';
import { SHOW_IN_FULL_VIEW_MESSAGE } from '../../utils/functions/popOut';
import {
  closePinGuide,
  openPinGuide,
  openSettingsPage,
  openSetup,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { selectRunHere } from '../../redux/firstRun';
import { RUN_LOCK, holdTourLock } from '../../utils/functions/tourLock';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import {
  finishSetup,
  initialState as settingsInitial,
  settingsDataStateSlice,
} from '../../redux/slices/settingsDataStateSlice';
import { RUN_FINISHED_SETTINGS } from '../fixtures/firstRunFixture';
import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';

// KAN-7, in the full view: asked on the address or by the worker's message.

const seededWith =
  (settings: object) => (store: { dispatch: (action: unknown) => void }) => {
    store.dispatch(
      settingsDataStateSlice.actions.replaceState({
        ...settingsInitial,
        ...settings,
      })
    );
    localStorage.setItem('settingsData', JSON.stringify(settings));
  };
// Nothing due, so the first-open queue opens nothing in either view.
const granted = seededWith({
  cloudConsent: 'granted',
  ...RUN_FINISHED_SETTINGS,
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  history.replaceState(null, '', '?');
  localStorage.clear();
  delete document.documentElement.dataset.firstOpen;
  delete document.documentElement.dataset.firstOpenCard;
  vi.restoreAllMocks();
});

describe('takeShowFromAddress', () => {
  test('an unknown request is taken off and ignored', () => {
    history.replaceState(null, '', '?view=tab&show=theme');
    expect(takeShowFromAddress()).toBeNull();
    expect(window.location.search).toBe('?view=tab');
  });

  // KAN-624. The worker never puts the run on an address; one there would replace the whole open.
  test('the run on the address is taken off and ignored', () => {
    history.replaceState(null, '', '?view=tab&show=run');
    expect(takeShowFromAddress()).toBeNull();
    expect(window.location.search).toBe('?view=tab');
  });

  test('no request leaves the address alone', () => {
    history.replaceState(null, '', '?view=tab');
    expect(takeShowFromAddress()).toBeNull();
    expect(window.location.search).toBe('?view=tab');
  });
});

describe('showInFullView', () => {
  test('setup: pending again after it finished, and open', () => {
    const { store } = makeTestStore();
    store.dispatch(finishSetup());
    store.dispatch(showInFullView('setup'));
    expect(store.getState().settingsDataState.setupState).toBe('pending');
    expect(store.getState().globalState.isSetupOpen).toBe(true);
  });

  // KAN-589. From Settings → Help, setup opens over the home page, as Show me around's run does.
  test('setup: leaves the Settings page first', async () => {
    const { store } = makeTestStore();
    await store.dispatch(openSettingsPage(SettingsCategory.HELP));
    // PREMISE: on the Settings page.
    expect(store.getState().globalState.isSettingsPage).toBe(true);
    store.dispatch(showInFullView('setup'));
    expect(store.getState().globalState.isSettingsPage).toBe(false);
    expect(store.getState().globalState.isSetupOpen).toBe(true);
  });

  test('never over a modal dialog', () => {
    const { store } = makeTestStore();
    const modal = document.createElement('dialog');
    vi.spyOn(document, 'querySelector').mockImplementation(
      (selector: string) => (selector === 'dialog:modal' ? modal : null)
    );
    store.dispatch(showInFullView('setup'));
    expect(store.getState().globalState.isSetupOpen).toBe(false);
    expect(store.getState().settingsDataState.setupState).toBe('none');
  });
});

// KAN-579. A native file picker closes the popup, so the popup's backup buttons ask the full view to do it.
describe('showInFullView: the backup file steps', () => {
  test('saveBackup: Settings on Sync & Backup, and the backup file downloads', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = makeTestStore();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });

    store.dispatch(showInFullView('saveBackup'));

    await waitFor(() =>
      expect(store.getState().globalState.isSettingsPage).toBe(true)
    );
    expect(
      store.getState().settingsCategoryState.find((c) => c.isSelected)?.name
    ).toBe(SettingsCategory.SYNC);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^tabkeeper_backup_.*\.json$/);
    expect(clicked[0].href).toMatch(/^data:text\/json/);
  });

  test('loadBackup: Settings on Sync & Backup, and the file picker opens', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = makeTestStore();
    const picked: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement
    ) {
      picked.push(this);
    });

    store.dispatch(showInFullView('loadBackup'));

    await waitFor(() =>
      expect(store.getState().globalState.isSettingsPage).toBe(true)
    );
    expect(
      store.getState().settingsCategoryState.find((c) => c.isSelected)?.name
    ).toBe(SettingsCategory.SYNC);
    expect(picked.map((input) => [input.type, input.accept])).toEqual([
      ['file', '.json'],
    ]);
  });

  test('a new full view opened with show=loadBackup opens the picker', async () => {
    history.replaceState(null, '', '?view=tab&show=loadBackup');
    const picked = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);

    await renderWithProviders(<App />, {
      seed: { tabs: [{ id: 5, windowId: 1 }], currentTabId: 5 },
      seedStore: granted,
    });

    await waitFor(() => expect(picked).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('?view=tab');
  });
});

describe('the full view, asked', () => {
  test('by the worker: a message naming this tab opens it; one naming another tab does not', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = await renderWithProviders(<App />, {
      seed: { tabs: [{ id: 5, windowId: 1 }], currentTabId: 5 },
      seedStore: granted,
    });
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('none')
    );
    const send = (tabId: number, show: 'setup' | 'pinGuide') =>
      act(() => {
        void chrome.runtime.sendMessage({
          type: SHOW_IN_FULL_VIEW_MESSAGE,
          tabId,
          show,
        });
      });
    // The page learns its own tab id asynchronously; the first message after it lands opens the guide.
    await waitFor(() => {
      send(5, 'pinGuide');
      expect(store.getState().globalState.isPinGuideOpen).toBe(true);
    });
    act(() => {
      store.dispatch(closePinGuide());
    });
    send(9, 'setup');
    expect(store.getState().globalState.isSetupOpen).toBe(false);
    send(5, 'setup');
    expect(store.getState().globalState.isSetupOpen).toBe(true);
  });
});

// KAN-624. Start or Get started in the popup, with a full view the worker only focused.
describe('showInFullView: the run', () => {
  const RUN = {
    view: 'full',
    step: 0,
    sessionId: null,
    hello: 'whatsNew',
    helloIn: 'popup',
    welcomeShows: null,
    ended: null,
  };
  let locks: FakeLocks;
  beforeEach(() => {
    locks = installFakeLocks();
    // A run of the full view shows only in a full view.
    history.replaceState(null, '', '?view=tab');
  });
  afterEach(() => {
    locks.uninstall();
    delete document.documentElement.dataset.runCheck;
  });

  // The popup's write, as this page finds it before its storage event lands.
  const popupWrote = (firstRun: object) =>
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...RUN_FINISHED_SETTINGS, firstRun })
    );

  test('the record the popup wrote is taken in and shown here, before its storage event', async () => {
    const { store } = makeTestStore();
    // PREMISE: this page holds no record yet; the popup's is only on disk.
    expect(store.getState().settingsDataState.firstRun).toBeNull();
    popupWrote(RUN);
    store.dispatch(showInFullView('run'));
    await waitFor(() =>
      expect(store.getState().globalState.isRunHere).toBe(true)
    );
    expect(selectRunHere(store.getState())).toMatchObject({
      view: 'full',
      step: 0,
      helloIn: 'popup',
    });
    expect(document.documentElement.dataset.runCheck).toBe('resumed');
  });

  test('Settings and a search give way, as a start’s do', async () => {
    const { store } = makeTestStore();
    await store.dispatch(openSettingsPage(SettingsCategory.HELP));
    store.dispatch(setSearchInputText('kyoto'));
    popupWrote(RUN);
    store.dispatch(showInFullView('run'));
    await waitFor(() =>
      expect(store.getState().globalState.isRunHere).toBe(true)
    );
    expect(store.getState().globalState.isSettingsPage).toBe(false);
    expect(store.getState().globalState.searchInputText).toBe('');
  });

  test('the pin guide and setup give way too; the run outranks both at an open', async () => {
    const { store } = makeTestStore();
    store.dispatch(openPinGuide());
    store.dispatch(openSetup());
    popupWrote(RUN);
    store.dispatch(showInFullView('run'));
    await waitFor(() =>
      expect(store.getState().globalState.isRunHere).toBe(true)
    );
    expect(store.getState().globalState.isPinGuideOpen).toBe(false);
    expect(store.getState().globalState.isSetupOpen).toBe(false);
  });

  test('another page showing the run: this one stands down, its Settings left open', async () => {
    const { store } = makeTestStore();
    await store.dispatch(openSettingsPage(SettingsCategory.HELP));
    await holdTourLock(RUN_LOCK);
    popupWrote(RUN);
    store.dispatch(showInFullView('run'));
    await waitFor(() =>
      expect(document.documentElement.dataset.runCheck).toBe('elsewhere')
    );
    expect(store.getState().globalState.isRunHere).toBe(false);
    expect(store.getState().globalState.isSettingsPage).toBe(true);
  });

  test('a record that is not a running full-view run: nothing changes', async () => {
    const { store } = makeTestStore();
    await store.dispatch(openSettingsPage(SettingsCategory.HELP));
    // A valid record of the popup's run (step 0 there would need welcomeShows).
    popupWrote({ ...RUN, view: 'popup', step: 1 });
    store.dispatch(showInFullView('run'));
    // Past every microtask the lock query and the thunk's awaits would take.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(store.getState().globalState.isRunHere).toBe(false);
    expect(store.getState().globalState.isSettingsPage).toBe(true);
    expect(document.documentElement.dataset.runCheck).toBeUndefined();
  });
});
