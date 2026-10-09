import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { OPEN_IN_POPUP_MESSAGE } from '../../utils/functions/openInPopup';

// KAN-437. The button only sends; openInPopup.test.ts covers what the worker does with it.
const renderFullView = () => {
  history.replaceState(null, '', '?view=tab');
  return renderWithProviders(<MenuContainer />, {
    seed: { windows: [{ id: 7 }] },
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
      seed: { windows: [{ id: 7 }] },
    });

    expect(
      screen.queryByRole('button', { name: 'Open compact view' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open full view' })
    ).toBeInTheDocument();
  });
});
