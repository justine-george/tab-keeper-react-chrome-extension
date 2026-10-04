import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FullViewOfferModal } from '../../components/modals/FullViewOfferModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openFullViewOffer } from '../../redux/slices/globalStateSlice';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-7 §3. Either button, ✕ or Esc ends the offer for good; "Open full view"
// hands the request to the worker, which outlives the popup.

const render = () =>
  renderWithProviders(<FullViewOfferModal />, {
    seed: { windows: [{ id: 7 }] },
    seedStore: (store) => {
      store.dispatch(openFullViewOffer());
    },
  });

const dialog = () => screen.getByRole('dialog', { name: 'Try the full view' });

afterEach(() => localStorage.clear());

describe('Try the full view', () => {
  test('opens unlit, saying what the full view is', async () => {
    await render();
    expect(document.activeElement).toBe(dialog());
    expect(dialog()).toHaveAccessibleDescription(
      'See every open window and tab beside your saved sessions, with room to sort, move and tidy them.'
    );
  });

  test('Open full view asks the worker, records the answer, and closes', async () => {
    const { store, chrome } = await render();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open full view' })
    );

    await waitFor(() =>
      expect(chrome.sentMessages).toEqual([
        { type: OPEN_IN_TAB_MESSAGE, windowId: 7 },
      ])
    );
    expect(store.getState().settingsDataState.isFullViewOfferAnswered).toBe(
      true
    );
    expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
  });

  test.each(['Not now', 'Close'])(
    '%s records the answer, sends nothing, and closes',
    async (name) => {
      const { store, chrome } = await render();
      await userEvent.click(screen.getByRole('button', { name }));

      expect(store.getState().settingsDataState.isFullViewOfferAnswered).toBe(
        true
      );
      expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
      expect(chrome.sentMessages).toEqual([]);
    }
  );

  test('Esc means Not now, and is not left to close the popup', async () => {
    const { store, chrome } = await render();
    const cancel = new Event('cancel', { bubbles: false, cancelable: true });
    fireEvent(dialog(), cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(store.getState().settingsDataState.isFullViewOfferAnswered).toBe(
      true
    );
    expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
    expect(chrome.sentMessages).toEqual([]);
  });
});
