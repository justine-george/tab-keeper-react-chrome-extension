import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openFullViewCallout } from '../../redux/slices/globalStateSlice';
import { showWhenQuiet } from '../../redux/quietCards';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-7 §6. Under ⤢ in the popup, once; Try it, ✕, Esc or ⤢ mark it seen.

const TEXT = 'See your saved sessions and open tabs side by side.';
const render = (open = true) =>
  renderWithProviders(<MenuContainer />, {
    seed: { windows: [{ id: 7 }] },
    seedStore: (store) => {
      if (open) store.dispatch(openFullViewCallout());
    },
  });
const callout = () => screen.queryByRole('dialog', { name: TEXT });
const openCallout = () => screen.getByRole('dialog', { name: TEXT });

afterEach(() => {
  endDragHold();
  delete document.documentElement.dataset.firstOpenCard;
  localStorage.clear();
});

describe('the full-view callout', () => {
  test('appearing leaves the focus where it was', async () => {
    const { store } = await render(false);
    const sort = screen.getByRole('button', { name: 'Sort sessions' });
    sort.focus();
    act(() => {
      store.dispatch(openFullViewCallout());
    });
    expect(openCallout()).toBeInTheDocument();
    expect(document.activeElement).toBe(sort);
  });

  test('Try it opens the full view, marks it seen, and closes', async () => {
    const { store, chrome } = await render();
    fireEvent.click(
      within(openCallout()).getByRole('button', { name: 'Try it' })
    );
    await waitFor(() =>
      expect(chrome.sentMessages).toEqual([
        { type: OPEN_IN_TAB_MESSAGE, windowId: 7 },
      ])
    );
    expect(store.getState().settingsDataState.isFullViewCalloutSeen).toBe(true);
    expect(callout()).toBeNull();
  });

  test('✕ marks it seen and closes, and opens nothing', async () => {
    const { store, chrome } = await render();
    fireEvent.click(
      within(openCallout()).getByRole('button', { name: 'Close' })
    );
    expect(store.getState().settingsDataState.isFullViewCalloutSeen).toBe(true);
    expect(callout()).toBeNull();
    expect(chrome.sentMessages).toEqual([]);
  });

  test('Esc means ✕', async () => {
    const { store } = await render();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(store.getState().settingsDataState.isFullViewCalloutSeen).toBe(true);
    expect(callout()).toBeNull();
  });

  test('the Esc it consumes is defaultPrevented, or Chrome closes the popup (KAN-403)', async () => {
    await render();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(callout()).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  test('an Escape a field already handled leaves it open', async () => {
    await render();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(callout()).toBeInTheDocument();
  });

  test('an Escape with nothing open is left to Chrome', async () => {
    await render(false);
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });

  test('an Esc that cancels a live drag leaves it open and untouched', async () => {
    await render();
    beginDragHold();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(callout()).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(false);
  });

  test('an Esc a modal dialog is about to cancel leaves it open and untouched', async () => {
    await render();
    const modal = document.createElement('dialog');
    document.body.append(modal);
    // jsdom has no showModal; it is what makes the dialog match :modal.
    const matches = vi
      .spyOn(document, 'querySelector')
      .mockImplementation((selector: string) =>
        selector === 'dialog:modal' ? modal : null
      );
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });
    matches.mockRestore();
    modal.remove();
    expect(callout()).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(false);
  });

  test('pressing ⤢ itself marks it seen', async () => {
    const { store, chrome } = await render();
    fireEvent.click(screen.getByRole('button', { name: 'Open full view' }));
    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(store.getState().settingsDataState.isFullViewCalloutSeen).toBe(true);
    expect(callout()).toBeNull();
  });

  // CONTROL: 'pressing ⤢ itself marks it seen', with the callout on screen.
  test('⤢ pressed during the wait leaves the callout unseen', async () => {
    const { store } = await render(false);
    void showWhenQuiet(
      () => store.dispatch(openFullViewCallout()),
      store.getState
    );
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Open full view' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open full view' }));
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpenCard).toBe('skipped')
    );
    expect(store.getState().settingsDataState.isFullViewCalloutSeen).toBe(
      false
    );
    expect(callout()).toBeNull();
  });
});
