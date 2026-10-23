import { describe, expect, test } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { toastTexts } from '../setup/toasts';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import {
  runShownHere,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { newRun, type RunStep } from '../../utils/functions/firstRun';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-592 (picks K1, F2). The Delete key deletes the session whose row has focus, as the
// header ⋮'s Delete session does; the ⋮ shows the key beside that item.
// KAN-638. With the ⋮ open, the same key runs that item, on every OS.

const SHOWN = buildSession({ tabGroupId: 'shown', title: 'Roadmap' });
const OTHER = buildSession({ tabGroupId: 'kyoto', title: 'Kyoto' });

type Os = chrome.runtime.PlatformInfo['os'];

const renderList = (platformOs: Os = 'mac', runStep?: RunStep) =>
  renderWithProviders(<TabGroupEntryContainer />, {
    seed: { platformOs },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SHOWN, OTHER])));
      store.dispatch(selectTabContainer('shown'));
      if (runStep !== undefined) {
        store.dispatch(
          recordFirstRun({ ...newRun('popup', runStep), sessionId: 'shown' })
        );
        store.dispatch(runShownHere());
      }
    },
  });

type Store = Awaited<ReturnType<typeof renderList>>['store'];
const ids = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
const row = (title: string) => screen.getByRole('button', { name: title });

describe('the Delete key on a focused session row (KAN-592)', () => {
  test.each([
    ['⌫', { key: 'Backspace' }],
    ['fn ⌫ / Delete', { key: 'Delete' }],
    ['⌘⌫', { key: 'Backspace', metaKey: true }],
  ])('%s deletes that row’s session and says so', async (_, init) => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), init);

    await waitFor(() => expect(ids(store)).toEqual(['shown']));
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
    ]);
  });

  test('a held key’s repeats delete nothing', async () => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), { key: 'Backspace', repeat: true });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
  ])('%s with the key deletes nothing', async (_, mods) => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), { key: 'Backspace', ...mods });
    fireEvent.keyDown(row('Kyoto'), { key: 'Delete', ...mods });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('other keys on the row do what they did', async () => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), { key: 'a' });
    fireEvent.keyDown(row('Kyoto'), { key: 'Escape' });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('the key prevents the browser’s own handling', async () => {
    await renderList();

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    row('Kyoto').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  test('while the tour holds Delete on its session, the key deletes nothing', async () => {
    const { store } = await renderList('mac', 6);

    fireEvent.keyDown(row('Roadmap'), { key: 'Backspace' });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('CONTROL: at another tour step the key deletes as the ⋮ does', async () => {
    const { store } = await renderList('mac', 4);

    fireEvent.keyDown(row('Roadmap'), { key: 'Backspace' });

    await waitFor(() => expect(ids(store)).toEqual(['kyoto']));
  });

  test.each([
    ['mac', 'Backspace Meta+Backspace Delete'],
    ['win', 'Delete Backspace'],
  ] as const)('the row names its keys on %s', async (os, keys) => {
    await renderList(os);
    // Once Chrome has answered, so the PC form is not read before a Mac answer replaces it.
    await act(async () => {
      await chrome.runtime.getPlatformInfo();
    });

    expect(row('Kyoto')).toHaveAttribute('aria-keyshortcuts', keys);
  });
});

// KAN-688 (pick A). With nothing focused, Delete (fn⌫ on a Mac, Del on a PC) deletes the
// session shown; ⌫ does not, as it is the key a typo reaches for. Each press deletes the one
// shown then, and focus stays where it was, so a later ⌫ still deletes nothing.
describe('the Delete key with nothing focused (KAN-688)', () => {
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    return event;
  };

  test('Delete deletes the session shown and says so', async () => {
    const { store } = await renderList();
    // PREMISE: nothing has focus.
    expect(document.activeElement).toBe(document.body);

    const event = press({ key: 'Delete' });

    await waitFor(() => expect(ids(store)).toEqual(['kyoto']));
    expect(event.defaultPrevented).toBe(true);
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
    ]);
  });

  test('a second press deletes the session shown next, and focus stays put', async () => {
    const { store } = await renderList();

    press({ key: 'Delete' });
    await waitFor(() => expect(ids(store)).toEqual(['kyoto']));
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'kyoto'
    );
    expect(document.activeElement).toBe(document.body);

    press({ key: 'Delete' });
    await waitFor(() => expect(ids(store)).toEqual([]));
  });

  test.each([
    ['⌫', { key: 'Backspace' }],
    ['⌘⌫', { key: 'Backspace', metaKey: true }],
    ['⌘ Delete', { key: 'Delete', metaKey: true }],
    ['Ctrl Delete', { key: 'Delete', ctrlKey: true }],
    ['Alt Delete', { key: 'Delete', altKey: true }],
    ['Shift Delete', { key: 'Delete', shiftKey: true }],
    ['a held key’s repeat', { key: 'Delete', repeat: true }],
  ])('%s deletes nothing', async (_, init) => {
    const { store } = await renderList();

    const event = press(init);

    expect(ids(store)).toEqual(['shown', 'kyoto']);
    expect(event.defaultPrevented).toBe(false);
  });

  test('a Delete another handler took deletes nothing', async () => {
    const { store } = await renderList();
    const take = (e: Event) => e.preventDefault();
    document.body.addEventListener('keydown', take);
    try {
      press({ key: 'Delete' });
    } finally {
      document.body.removeEventListener('keydown', take);
    }

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test.each(['data-dragging', 'data-carrying'])(
    'during a drag or carry (%s) Delete deletes nothing',
    async (attribute) => {
      const { store } = await renderList();
      document.documentElement.setAttribute(attribute, '');
      try {
        press({ key: 'Delete' });
      } finally {
        document.documentElement.removeAttribute(attribute);
      }

      expect(ids(store)).toEqual(['shown', 'kyoto']);
    }
  );

  test('with focus on something that is not a row, Delete deletes nothing', async () => {
    const { store } = await renderList();
    const field = document.createElement('input');
    document.body.append(field);
    try {
      act(() => field.focus());
      fireEvent.keyDown(field, { key: 'Delete' });
    } finally {
      field.remove();
    }

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  // A search that matches nothing leaves no session on screen to delete.
  test('under a search with no match, Delete deletes nothing', async () => {
    const { store } = await renderList();
    act(() => {
      store.dispatch(setSearchInputText('zzz no such session'));
    });
    // PREMISE: no row is drawn.
    expect(screen.queryByRole('button', { name: 'Roadmap' })).toBeNull();

    press({ key: 'Delete' });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('while the tour holds Delete on the session shown, Delete deletes nothing', async () => {
    const { store } = await renderList('mac', 6);

    press({ key: 'Delete' });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('CONTROL: at another tour step Delete deletes the session shown', async () => {
    const { store } = await renderList('mac', 4);

    press({ key: 'Delete' });

    await waitFor(() => expect(ids(store)).toEqual(['kyoto']));
  });
});

describe('the ⋮ shows the key beside Delete session (K1)', () => {
  const renderHeader = (platformOs: Os) =>
    renderWithProviders(<HeroContainerRight />, {
      seed: { platformOs, windows: [{ id: 1 }] },
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SHOWN])));
        store.dispatch(selectTabContainer('shown'));
      },
    });

  test.each([
    ['mac', '⌫'],
    ['win', 'Del'],
    ['linux', 'Del'],
  ] as const)('on %s: %s, hidden from the item’s name', async (os, hint) => {
    await renderHeader(os);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    const item = screen.getByRole('menuitem', { name: 'Delete session' });
    await waitFor(() =>
      expect(within(item).getByText(hint)).toHaveAttribute(
        'aria-hidden',
        'true'
      )
    );
  });

  test('other items show no key', async () => {
    await renderHeader('mac');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    // The label is the item's last text: nothing follows it.
    expect(
      screen.getByRole('menuitem', { name: 'Copy all links' }).textContent
    ).toMatch(/Copy all links$/);
  });
});

describe('with the ⋮ open, the key runs Delete session (KAN-638)', () => {
  const renderOpenMenu = async (platformOs: Os = 'mac') => {
    const rendered = await renderWithProviders(<HeroContainerRight />, {
      seed: { platformOs, windows: [{ id: 1 }] },
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SHOWN, OTHER])));
        store.dispatch(selectTabContainer('shown'));
      },
    });
    await act(async () => {
      await chrome.runtime.getPlatformInfo();
    });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    return rendered;
  };
  // Opening focuses the first item; the key lands there.
  const focusedItem = () =>
    screen.getByRole('menuitem', { name: 'Copy all links' });

  describe.each(['mac', 'win', 'linux'] as const)('on %s', (os) => {
    test.each([
      ['⌫', { key: 'Backspace' }],
      ['Delete', { key: 'Delete' }],
      ['⌘⌫', { key: 'Backspace', metaKey: true }],
    ])(
      '%s deletes the shown session, says so and closes the menu',
      async (_, init) => {
        const { store } = await renderOpenMenu(os);

        fireEvent.keyDown(focusedItem(), init);

        await waitFor(() => expect(ids(store)).toEqual(['kyoto']));
        expect(toastTexts(store.getState())).toEqual([
          TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
        ]);
        expect(screen.queryByRole('menu')).toBeNull();
      }
    );
  });

  test('a held key’s repeats delete nothing', async () => {
    const { store } = await renderOpenMenu();

    fireEvent.keyDown(focusedItem(), { key: 'Backspace', repeat: true });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
  ])(
    '%s with the key deletes nothing and leaves the menu open',
    async (_, mods) => {
      const { store } = await renderOpenMenu();

      fireEvent.keyDown(focusedItem(), { key: 'Backspace', ...mods });
      fireEvent.keyDown(focusedItem(), { key: 'Delete', ...mods });

      expect(ids(store)).toEqual(['shown', 'kyoto']);
      expect(screen.getByRole('menu')).toBeInTheDocument();
    }
  );

  test('the arrows still walk the menu', async () => {
    const { store } = await renderOpenMenu();

    fireEvent.keyDown(focusedItem(), { key: 'ArrowDown' });

    expect(
      screen.getByRole('menuitem', { name: /^Save as PDF/ })
    ).toHaveFocus();
    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('the key prevents the browser’s own handling', async () => {
    await renderOpenMenu();

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    focusedItem().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  test.each([
    ['mac', 'Backspace Meta+Backspace Delete'],
    ['win', 'Delete Backspace'],
  ] as const)(
    'Delete session names its keys on %s; other items name none',
    async (os, keys) => {
      await renderOpenMenu(os);

      expect(
        screen.getByRole('menuitem', { name: 'Delete session' })
      ).toHaveAttribute('aria-keyshortcuts', keys);
      expect(focusedItem()).not.toHaveAttribute('aria-keyshortcuts');
    }
  );
});
