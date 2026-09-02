import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { SAVE_TAB_CONTAINER_ACTION } from '../../utils/constants/actionTypes';
import { TOAST_MESSAGES } from '../../utils/constants/common';

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

  // Both buttons used to raise the same "Session saved." toast, so the only
  // confirmation the user got could not tell them which save had happened --
  // on the one screen where the two actions look alike. The two tests below
  // are each other's control: asserting one message in isolation would still
  // pass if both buttons produced it.
  async function toastAfterClicking(label: string) {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: twoWindows,
    });
    await screen.findByDisplayValue('Kagi Search');
    await userEvent.click(screen.getByLabelText(label));
    return store.getState().globalState.toastText;
  }

  test('saving every window says so', async () => {
    expect(await toastAfterClicking('save session')).toBe(
      TOAST_MESSAGES.SAVE_ALL_WINDOWS_SUCCESS
    );
  });

  test('saving only the current window says so instead', async () => {
    expect(await toastAfterClicking('save current window')).toBe(
      TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS
    );
  });

  test('the two toasts are not the same message', () => {
    expect(TOAST_MESSAGES.SAVE_ALL_WINDOWS_SUCCESS).not.toBe(
      TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS
    );
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
