import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  ensureCloudSession: () => {},
  isCloudConfigured: false,
}));

// The tab-groups check answers when the test says, so a tour can start while it is out.
const gate = vi.hoisted(
  (): { asked: boolean; answer: (count: number | null) => void } => ({
    asked: false,
    answer: () => undefined,
  })
);
vi.mock('../../utils/functions/tabGroupsOffer', () => ({
  shouldOfferTabGroups: () =>
    new Promise<number | null>((resolve) => {
      gate.asked = true;
      gate.answer = resolve;
    }),
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import { tourStartedHere } from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-413. A tour started mid-decision: nothing opens over it this open.

const granted = (store: { dispatch: (action: unknown) => void }) => {
  store.dispatch(
    settingsDataStateSlice.actions.replaceState({
      ...settingsInitial,
      cloudConsent: 'granted',
    })
  );
  localStorage.setItem(
    'settingsData',
    JSON.stringify({ cloudConsent: 'granted' })
  );
};

beforeEach(() => {
  localStorage.clear();
  gate.asked = false;
});
afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.firstOpen;
});

describe('the first-open list stands down for a tour', () => {
  test('a tour started while the tab-groups check is out: no prompt this open', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: granted,
    });
    await waitFor(() => expect(gate.asked).toBe(true));
    act(() => {
      store.dispatch(tourStartedHere('sample:x'));
    });
    gate.answer(2);
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('none')
    );
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
  });

  test('CONTROL: with no tour, the same answer opens the prompt', async () => {
    const { store } = await renderWithProviders(<App />, {
      seedStore: granted,
    });
    await waitFor(() => expect(gate.asked).toBe(true));
    gate.answer(2);
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBe('tabGroups')
    );
    expect(store.getState().globalState.tabGroupsPromptCount).toBe(2);
  });
});
