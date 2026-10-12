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
import { closePinGuide } from '../../redux/slices/globalStateSlice';
import {
  finishSetup,
  initialState as settingsInitial,
  settingsDataStateSlice,
} from '../../redux/slices/settingsDataStateSlice';
import { RUN_FINISHED_SETTINGS } from '../fixtures/firstRunFixture';

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
