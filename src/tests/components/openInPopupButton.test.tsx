import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { OPEN_IN_POPUP_MESSAGE } from '../../utils/functions/openInPopup';

// KAN-437. The button only sends; openInPopup.test.ts covers what the worker does with it.
// action: {} is Chrome 127+, where action.openPopup exists.
const renderFullView = (action: ChromeSeed['action'] = {}) => {
  history.replaceState(null, '', '?view=tab');
  return renderWithProviders(<MenuContainer />, {
    seed: { action, windows: [{ id: 7 }] },
  });
};

afterEach(() => {
  history.replaceState(null, '', '?');
});

describe("the full view's Open compact view button (KAN-437)", () => {
  test("sits in Open full view's slot: first, then Sort sessions", async () => {
    await renderFullView();

    const names = screen.getAllByRole('button').map((el) => el.ariaLabel);
    expect(names.slice(0, 2)).toEqual(['Open compact view', 'Sort sessions']);
  });

  test('draws close_fullscreen, the inward twin of open_in_full', async () => {
    await renderFullView();

    expect(
      screen.getByRole('button', { name: 'Open compact view' })
    ).toHaveTextContent('close_fullscreen');
  });

  test('its tooltip says what it does', async () => {
    await renderFullView();

    expect(
      screen.getByRole('button', { name: 'Open compact view' })
    ).toHaveAttribute('title', 'Open compact view');
  });

  test('a click sends one openInPopup message', async () => {
    const { chrome } = await renderFullView();

    fireEvent.click(screen.getByRole('button', { name: 'Open compact view' }));

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(chrome.sentMessages).toEqual([{ type: OPEN_IN_POPUP_MESSAGE }]);
  });

  test('is absent in the popup, where Open full view stands instead', async () => {
    await renderWithProviders(<MenuContainer />, {
      seed: { action: {}, windows: [{ id: 7 }] },
    });

    expect(
      screen.queryByRole('button', { name: 'Open compact view' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open full view' })
    ).toBeInTheDocument();
  });

  // R10. Before Chrome 127 an ordinary extension has no action.openPopup; the press would do nothing.
  test('is absent in a full view whose Chrome has no action.openPopup', async () => {
    await renderFullView({ hasOpenPopup: false });

    expect(
      screen.queryByRole('button', { name: 'Open compact view' })
    ).not.toBeInTheDocument();
    // PREMISE: the full view's header drew.
    expect(
      screen.getByRole('button', { name: 'Sort sessions' })
    ).toBeInTheDocument();
  });

  test('is absent in a full view with no chrome.action at all', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderWithProviders(<MenuContainer />, {
      seed: { windows: [{ id: 7 }] },
    });

    expect(
      screen.queryByRole('button', { name: 'Open compact view' })
    ).not.toBeInTheDocument();
  });

  test("CONTROL: without action.openPopup, the popup's Open full view still stands", async () => {
    await renderWithProviders(<MenuContainer />, {
      seed: { action: { hasOpenPopup: false }, windows: [{ id: 7 }] },
    });

    expect(
      screen.getByRole('button', { name: 'Open full view' })
    ).toBeInTheDocument();
  });
});
