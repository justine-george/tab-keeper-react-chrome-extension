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
    await userEvent.click(
      screen.getByLabelText('Save all open windows as a session')
    );

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
    await userEvent.click(
      screen.getByLabelText('Save all open windows as a session')
    );

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows).toHaveLength(2);
    expect(tabGroups[0].windowCount).toBe(2);
  });

  test('the current-window button captures only the current window', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: twoWindows,
    });

    await screen.findByDisplayValue('Kagi Search');
    await userEvent.click(
      screen.getByLabelText('Save current window as a session')
    );

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
    expect(await toastAfterClicking('Save all open windows as a session')).toBe(
      TOAST_MESSAGES.SAVE_ALL_WINDOWS_SUCCESS
    );
  });

  test('saving only the current window says so instead', async () => {
    expect(await toastAfterClicking('Save current window as a session')).toBe(
      TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS
    );
  });

  test('the two toasts are not the same message', () => {
    expect(TOAST_MESSAGES.SAVE_ALL_WINDOWS_SUCCESS).not.toBe(
      TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS
    );
  });

  // The two buttons sit side by side and do different things, so they must not
  // look alike. They did once: both carried a "+" so that both would read as
  // "save", which made the "+" shared vocabulary instead of distinguishing
  // vocabulary and left two near-identical glyphs. Only the primary carries it
  // now. Their relative *size* is the other half of the hierarchy and is
  // verified visually, not here -- jsdom does not lay anything out.
  test('the two save buttons do not render the same icon', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: twoWindows });
    await screen.findByDisplayValue('Kagi Search');

    const glyph = (label: string) =>
      screen.getByLabelText(label).querySelector('.material-symbols-outlined')
        ?.textContent;

    expect(glyph('Save all open windows as a session')).toBeTruthy();
    expect(glyph('Save current window as a session')).toBeTruthy();
    expect(glyph('Save all open windows as a session')).not.toBe(
      glyph('Save current window as a session')
    );
  });

  // The tooltip is the only place either button says what it does in words,
  // and the pair used to read "Save current session" / "Save current window as
  // a session" -- both opening with "Save current", and the all-windows one
  // never mentioning all windows in any of the ten locales.
  //
  // testI18n loads the real en resources, so these assert the strings a user
  // actually sees rather than the keys.
  const tooltip = (label: string) =>
    screen.getByLabelText(label).getAttribute('title') ?? '';

  test('the all-windows tooltip says it saves all windows', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: twoWindows });
    await screen.findByDisplayValue('Kagi Search');

    expect(
      tooltip('Save all open windows as a session').toLowerCase()
    ).toContain('all');
  });

  test('the current-window tooltip says it saves the current window', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: twoWindows });
    await screen.findByDisplayValue('Kagi Search');

    expect(tooltip('Save current window as a session').toLowerCase()).toContain(
      'current'
    );
  });

  test('the two buttons do not share a tooltip', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: twoWindows });
    await screen.findByDisplayValue('Kagi Search');

    expect(tooltip('Save all open windows as a session')).not.toBe(
      tooltip('Save current window as a session')
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

// KAN-84. The save path already intended a fallback -- it read
// `newTitle || currentTabName` -- but `||` catches "" and not the truthy
// "   ", so a whitespace-only name passed straight through and produced a
// session with no visible name and no accessible name on its row.
//
// A fallback rather than a refusal here, unlike the rename path: there is no
// prior title to keep, so refusing would leave the user with no session at all
// for a keystroke they may not have noticed.
describe('a saved session always gets a name (KAN-84)', () => {
  const savedTitle = (store: {
    getState: () => {
      tabContainerDataState: { tabGroups: { title: string }[] };
    };
  }) => store.getState().tabContainerDataState.tabGroups[0]?.title;

  const typeNameAndSave = async (value: string) => {
    const rendered = await renderWithProviders(<UserInputContainer />, {
      seed,
    });
    const box = await screen.findByDisplayValue('Kagi Search');
    await userEvent.clear(box);
    if (value) await userEvent.type(box, value);
    await userEvent.click(
      screen.getByLabelText('Save all open windows as a session')
    );
    return rendered;
  };

  test.each([['   '], ['　'], ['']])(
    'falls back to the active tab title when the name is %j',
    async (blank) => {
      const { store } = await typeNameAndSave(blank);
      expect(savedTitle(store)).toBe('Kagi Search');
    }
  );

  // THE CONTROL. Every case above lands on the same string the box was
  // pre-filled with, so a save path that ignored the input entirely would pass
  // them all. This proves a typed name is actually honoured.
  test('CONTROL: a typed name is used', async () => {
    const { store } = await typeNameAndSave('Research');
    expect(savedTitle(store)).toBe('Research');
  });

  test('a typed name is stored trimmed', async () => {
    const { store } = await typeNameAndSave('  Research  ');
    expect(savedTitle(store)).toBe('Research');
  });
});
