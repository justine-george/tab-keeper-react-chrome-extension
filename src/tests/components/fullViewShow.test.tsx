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
  dismissPinGuide,
  finishSetup,
  initialState as settingsInitial,
  settingsDataStateSlice,
} from '../../redux/slices/settingsDataStateSlice';
import { RUN_FINISHED_SETTINGS } from '../fixtures/firstRunFixture';

// KAN-7, in the full view: asked on the address or by the worker's message.

const DAY = 24 * 60 * 60 * 1000;
// Rate due, so a first-open queue that ran would open the rate prompt.
const RATE_DUE = {
  cloudConsent: 'granted' as const,
  ...RUN_FINISHED_SETTINGS,
  extensionInstalledTime: Date.now() - 2 * DAY,
  lastValueMomentTime: Date.now() - 60 * 60 * 1000,
};
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
const seeded = seededWith(RATE_DUE);
// Nothing due, so the first-open queue opens nothing in either view.
const granted = seededWith({
  cloudConsent: 'granted',
  ...RUN_FINISHED_SETTINGS,
  isFullViewOfferAnswered: true,
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
  test('takes the request off the address, keeping view=tab', () => {
    history.replaceState(null, '', '?view=tab&show=setup');
    expect(takeShowFromAddress()).toBe('setup');
    expect(window.location.search).toBe('?view=tab');
    expect(takeShowFromAddress()).toBeNull();
  });

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

  test('the pin guide opens, and a dismissal stays a dismissal', () => {
    const { store } = makeTestStore();
    store.dispatch(dismissPinGuide());
    store.dispatch(showInFullView('pinGuide'));
    expect(store.getState().globalState.isPinGuideOpen).toBe(true);
    expect(store.getState().settingsDataState.isPinGuideDismissed).toBe(true);
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
  test('on its address: the dialog opens and the first-open queue stands down', async () => {
    history.replaceState(null, '', '?view=tab&show=setup');
    const { store } = await renderWithProviders(<App />, { seedStore: seeded });
    await waitFor(() =>
      expect(store.getState().globalState.isSetupOpen).toBe(true)
    );
    expect(document.documentElement.dataset.firstOpen).toBe('setup');
    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
    expect(window.location.search).toBe('?view=tab');
  });

  test('CONTROL: without a request the same open is the rate prompt’s', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = await renderWithProviders(<App />, { seedStore: seeded });
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('rate')
    );
    expect(store.getState().globalState.isSetupOpen).toBe(false);
  });

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

  // CONTROL: the test above, where the same message opens the guide in the full view.
  test('the popup ignores the message, even one naming its own tab', async () => {
    history.replaceState(null, '', '?');
    const { store } = await renderWithProviders(<App />, {
      seed: { tabs: [{ id: 5, windowId: 1 }], currentTabId: 5 },
      seedStore: granted,
    });
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('none')
    );
    // After this, a listener that asked for its tab id would know it.
    await act(async () => {
      await chrome.tabs.getCurrent();
    });
    act(() => {
      void chrome.runtime.sendMessage({
        type: SHOW_IN_FULL_VIEW_MESSAGE,
        tabId: 5,
        show: 'pinGuide',
      });
    });
    expect(store.getState().globalState.isPinGuideOpen).toBe(false);
  });
});
