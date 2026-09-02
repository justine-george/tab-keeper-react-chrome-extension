import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { SAVE_TAB_CONTAINER_ACTION } from '../../utils/constants/actionTypes';

const seed = {
  tabs: [
    { id: 1, title: 'Kagi Search', url: 'https://kagi.com/', active: true },
  ],
  windows: [
    {
      id: 7,
      tabs: [
        { id: 1, title: 'Kagi Search', url: 'https://kagi.com/' },
      ] as chrome.tabs.Tab[],
    },
  ],
};

describe('UserInputContainer', () => {
  test('pre-fills the session name from the active tab', async () => {
    await renderWithProviders(<UserInputContainer />, { seed });

    expect(await screen.findByDisplayValue('Kagi Search')).toBeTruthy();
  });

  test('saving dispatches a session built from the open windows', async () => {
    const { store, seen } = await renderWithProviders(<UserInputContainer />, {
      seed,
    });

    await screen.findByDisplayValue('Kagi Search');
    await userEvent.click(screen.getByLabelText('save session'));

    expect(seen).toContain(SAVE_TAB_CONTAINER_ACTION);
    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups).toHaveLength(1);
    expect(tabGroups[0].title).toBe('Kagi Search');
    expect(tabGroups[0].windows[0].tabs[0].url).toBe('https://kagi.com/');
  });
});

// KAN-5. Two buttons, one capture function, one scope argument. The pair is
// the point: "saved one window" alone is equally consistent with the scope
// working and with only one window being open, so each button is asserted
// against the same two-window seed.
//
// The fake answers windows.getCurrent with the first seeded window, so the
// Kagi window is the current one below.
describe('UserInputContainer save scope', () => {
  const twoWindows = {
    tabs: [
      { id: 1, title: 'Kagi Search', url: 'https://kagi.com/', active: true },
    ],
    windows: [
      {
        id: 7,
        tabs: [
          { id: 1, title: 'Kagi Search', url: 'https://kagi.com/' },
        ] as chrome.tabs.Tab[],
      },
      {
        id: 8,
        tabs: [
          { id: 2, title: 'Example', url: 'https://example.com/' },
        ] as chrome.tabs.Tab[],
      },
    ],
  };

  test('the save button captures every open window', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: twoWindows,
    });

    await screen.findByDisplayValue('Kagi Search');
    await userEvent.click(screen.getByLabelText('save session'));

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows).toHaveLength(2);
    expect(tabGroups[0].windowCount).toBe(2);
  });

  test('the current-window button captures only the current window', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: twoWindows,
    });

    await screen.findByDisplayValue('Kagi Search');
    await userEvent.click(screen.getByLabelText('save current window'));

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows).toHaveLength(1);
    expect(tabGroups[0].windowCount).toBe(1);
    expect(tabGroups[0].windows[0].tabs[0].url).toBe('https://kagi.com/');
  });

  // Enter in the name box has always meant "save everything". A second button
  // is a new way to save, not a change to the existing one.
  test('pressing Enter in the name box still captures every window', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: twoWindows,
    });

    const nameBox = await screen.findByDisplayValue('Kagi Search');
    await userEvent.type(nameBox, '{Enter}');

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows).toHaveLength(2);
  });
});
