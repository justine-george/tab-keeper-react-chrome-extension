import { describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { toastTexts, newestToast } from '../setup/toasts';
import { SAVE_TAB_CONTAINER_ACTION } from '../../utils/constants/actionTypes';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// A test holds a capture in flight by setting `captureGate`.
const captureGate = vi.hoisted(() => ({
  current: null as Promise<void> | null,
}));
vi.mock('../../utils/functions/capture', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/functions/capture')>();
  return {
    ...actual,
    captureOpenWindows: async (
      ...args: Parameters<typeof actual.captureOpenWindows>
    ) => {
      await captureGate.current;
      return actual.captureOpenWindows(...args);
    },
  };
});

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
  // KAN-211. The name an empty save uses is derived from the active tab, so it
  // is cleaned like any other derived title: "(3) Gmail" would store a badge
  // that is stale the moment it is saved. What the user types is never touched.
  test('an empty save drops the active tab unread badge from the name', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: {
        tabs: [
          {
            id: 1,
            title: '(9+) Kagi Search',
            url: 'https://kagi.com/',
            active: true,
          },
        ],
        windows: [
          {
            id: 7,
            tabs: [
              { id: 1, title: '(9+) Kagi Search', url: 'https://kagi.com/' },
            ] as chrome.tabs.Tab[],
          },
        ],
      },
    });
    await act(async () => {});

    await userEvent.click(
      screen.getByLabelText('Save all open windows as a session')
    );

    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Kagi Search'
    );
  });

  // N2. The tab title is the name an empty save falls back to; it is not put
  // in the field, which shows its placeholder instead.
  test('the name field starts empty and shows the placeholder', async () => {
    await renderWithProviders(<UserInputContainer />, { seed });
    await act(async () => {});

    const field = screen.getByPlaceholderText('Name the new session');
    expect(field).toHaveValue('');
    expect(screen.getByRole('textbox')).toBe(field);
  });

  test('a save with the field empty names the session after the active tab', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed,
    });
    await act(async () => {});

    await userEvent.click(
      screen.getByLabelText('Save all open windows as a session')
    );

    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Kagi Search'
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  test('saving dispatches a session built from the open windows', async () => {
    const { store, seen } = await renderWithProviders(<UserInputContainer />, {
      seed,
    });

    await act(async () => {});
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

    await act(async () => {});
    await userEvent.click(
      screen.getByLabelText('Save all open windows as a session')
    );

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows).toHaveLength(2);
    expect(tabGroups[0].windowCount).toBe(2);
  });

  // KAN-208. The current-window save moved into the row's menu; the wide
  // save-all button stayed where it was.
  const openSaveMenu = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    return screen.getByRole('menu');
  };

  test('the current-window item captures only the current window', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: twoWindows,
    });

    await act(async () => {});
    const menu = await openSaveMenu();
    await userEvent.click(
      within(menu).getByRole('menuitem', {
        name: 'Save current window as a session',
      })
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
    await act(async () => {});
    if (label === 'Save current window as a session') {
      const menu = await openSaveMenu();
      await userEvent.click(
        within(menu).getByRole('menuitem', { name: label })
      );
    } else {
      await userEvent.click(screen.getByLabelText(label));
    }
    return newestToast(store.getState())?.text;
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

  // KAN-208 removed three tests that lived here: the two save buttons no
  // longer sit side by side, so "they must not look alike", "their tooltips
  // must differ" and "they do not share a tooltip" have no subject. The
  // current-window save is a menu item now, and a menu item carries WORDS --
  // which is the stronger version of what those tests were protecting.
  //
  // The tooltip is the only place the remaining button says what it does in
  // words. testI18n loads the real en resources, so this asserts the string a
  // user actually sees rather than the key.
  const tooltip = (label: string) =>
    screen.getByLabelText(label).getAttribute('title') ?? '';

  test('the all-windows tooltip says it saves all windows', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: twoWindows });
    await act(async () => {});

    expect(
      tooltip('Save all open windows as a session').toLowerCase()
    ).toContain('all');
  });

  // Enter in the name box has always meant "save everything". A second way to
  // save is a new way to save, not a change to the existing one.
  test('pressing Enter in the name box still captures every window', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: twoWindows,
    });

    await act(async () => {});
    const nameBox = screen.getByRole('textbox');
    await userEvent.type(nameBox, '{Enter}');

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows).toHaveLength(2);
  });
});

// KAN-208. The row is one wide save and a menu.
//
// Two SAVES need two scopes, because a save is permanent and the wrong scope
// leaves clutter. Export creates nothing until a button on the preview is
// pressed, and the preview's edit mode can hide a whole window -- so there is
// ONE export item, covering everything open, and the scope is chosen after
// seeing it.
describe('the save row menu (KAN-208)', () => {
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

  const openSaveMenu = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    return screen.getByRole('menu');
  };

  test('the row keeps the save-all button, and the current-window save is in the menu rather than beside it', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: twoWindows });
    await act(async () => {});

    expect(
      screen.getByRole('button', { name: 'Save all open windows as a session' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'Save current window as a session',
      })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'More actions' })
    ).toHaveAttribute('aria-haspopup', 'menu');
  });

  test('the menu holds exactly two items, save first', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: twoWindows });
    await act(async () => {});

    const menu = await openSaveMenu();
    const items = within(menu).getAllByRole('menuitem');

    // Accessible names, not textContent: each item's aria-hidden glyph span
    // holds the ligature text ("add_box"), which textContent would include.
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName('Save current window as a session');
    expect(items[1]).toHaveAccessibleName('Export open windows…');
  });

  test('Export open windows… opens the live export page and saves nothing', async () => {
    // tabs.create() (called with no windowId) lands in the fake's current
    // window -- windows[0], window 7 here.
    const { store, seen, chrome } = await renderWithProviders(
      <UserInputContainer />,
      { seed: twoWindows }
    );
    await act(async () => {});

    const menu = await openSaveMenu();
    await userEvent.click(
      within(menu).getByRole('menuitem', { name: 'Export open windows…' })
    );

    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toBe(
      'chrome-extension://faketestid/export.html?source=open-windows'
    );
    // Not a save: no session, no save action, no toast.
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
    expect(seen).not.toContain(SAVE_TAB_CONTAINER_ACTION);
    expect(toastTexts(store.getState())).toEqual([]);
  });

  // CONTROL for the test above: the other item DOES save, through the same
  // menu -- so "nothing saved" is a property of the export item rather than of
  // the menu.
  test('CONTROL: the save item in the same menu does save', async () => {
    const { store, chrome } = await renderWithProviders(
      <UserInputContainer />,
      { seed: twoWindows }
    );
    await act(async () => {});

    const menu = await openSaveMenu();
    await userEvent.click(
      within(menu).getByRole('menuitem', {
        name: 'Save current window as a session',
      })
    );

    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1);
    expect(chrome.createdTabs).toHaveLength(0);
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
    await act(async () => {});
    const box = screen.getByRole('textbox');
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

  // THE CONTROL. Every case above lands on the active tab's title, so a save
  // path that ignored the input would pass them all.
  test('CONTROL: a typed name is used', async () => {
    const { store } = await typeNameAndSave('Research');
    expect(savedTitle(store)).toBe('Research');
  });

  test('a typed name is stored trimmed', async () => {
    const { store } = await typeNameAndSave('  Research  ');
    expect(savedTitle(store)).toBe('Research');
  });
});

// KAN-439. A stored save empties the name it used; a failed or raced one keeps the text.
describe('the name field after a save (KAN-439)', () => {
  const typeName = async (value: string, withSeed: object = seed) => {
    const rendered = await renderWithProviders(<UserInputContainer />, {
      seed: withSeed,
    });
    await act(async () => {});
    const box = screen.getByRole('textbox');
    if (value) await userEvent.type(box, value);
    return { ...rendered, box };
  };

  const saveByButton = () =>
    userEvent.click(
      screen.getByLabelText('Save all open windows as a session')
    );
  const saveByEnter = async () => {
    await userEvent.click(screen.getByRole('textbox'));
    await userEvent.keyboard('{Enter}');
  };

  test.each([
    ['the button', saveByButton],
    ['Enter', saveByEnter],
  ])('a typed save through %s empties the field', async (_how, save) => {
    const { store, box } = await typeName('Research');
    await save();

    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Research'
    );
    expect(box).toHaveValue('');
  });

  test('the current-window menu save empties the field too', async () => {
    const { store, box } = await typeName('Research');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Save current window as a session',
      })
    );

    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1);
    expect(box).toHaveValue('');
  });

  test.each([
    ['the button', saveByButton],
    ['Enter', saveByEnter],
  ])(
    'an untouched empty save through %s leaves it empty',
    async (_how, save) => {
      const { store, box } = await typeName('');
      await save();

      expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
        'Kagi Search'
      );
      expect(box).toHaveValue('');
    }
  );

  test.each([
    ['the button', saveByButton],
    ['Enter', saveByEnter],
  ])(
    'a save that captures nothing keeps the typed name (%s)',
    async (_how, save) => {
      const { store, box } = await typeName('Research', {
        tabs: [],
        windows: [],
      });
      await save();

      expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
      expect(box).toHaveValue('Research');
    }
  );

  test('text typed while the capture is in flight survives the save', async () => {
    let release = () => {};
    captureGate.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const { store, box } = await typeName('Research');
      await saveByButton();
      await userEvent.type(box, 'Next');
      release();
      await act(async () => {});

      expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1);
      expect(box).toHaveValue('ResearchNext');
    } finally {
      captureGate.current = null;
    }
  });
});
