import { afterEach, describe, expect, test } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab as tab } from '../fixtures/chromeTab';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { requestSessionRename } from '../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { ADD_CURR_WINDOW_TO_TABGROUP_ACTION } from '../../utils/constants/actionTypes';

// KAN-775, KAN-793. Every session row's right-click opens with Open · Switch · Replace, then Add current window; the header's right-click has the row but no Add, and its ⋮ neither.

const OWN_URL = 'chrome-extension://faketestid/index.html';
const twoTabs: ChromeSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        tab({ id: 11, url: 'https://docs.test/', title: 'Docs', active: true }),
        tab({ id: 12, url: 'https://mail.test/', title: 'Mail' }),
      ],
    },
  ],
};
const onlyTabKeeper: ChromeSeed = {
  windows: [
    {
      id: 1,
      tabs: [tab({ id: 10, url: OWN_URL, title: 'Tab Keeper', active: true })],
    },
  ],
};

const S1 = buildSession({ tabGroupId: 'S1', title: 'Trip' });
const S2 = buildSession({ tabGroupId: 'S2', title: 'Bravo' });

const renderList = (seed: ChromeSeed = twoTabs, folded = false) =>
  renderWithProviders(<TabGroupEntryContainer />, {
    seed,
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([S1, S2])));
      store.dispatch(selectTabContainer('S1'));
      store.dispatch(setFoldSavedSessionInTabView(folded));
    },
  });

// The element carrying the row's menu handlers.
const rowOf = (title: string): HTMLElement => {
  const row = screen
    .getByRole('button', { name: title })
    .closest<HTMLElement>('[data-drag-handle-row]');
  if (row === null) throw new Error(`no row for ${title}`);
  return row;
};
const rowMenu = () => {
  const menus = document.querySelectorAll<HTMLElement>('[data-row-menu]');
  expect(menus).toHaveLength(1);
  return menus[0];
};
const keys = () =>
  within(rowMenu())
    .getAllByRole('menuitem')
    .map((el) => el.getAttribute('data-menu-item'));
const actionRow = () =>
  rowMenu().querySelector<HTMLElement>('[data-menu-action-row]');
const actionRowNames = () => {
  const row = actionRow();
  if (row === null) throw new Error('no action row');
  return within(row)
    .getAllByRole('menuitem')
    .map((b) => b.getAttribute('aria-label'));
};
const item = (name: string) =>
  within(rowMenu()).getByRole('menuitem', { name });

type Store = Awaited<ReturnType<typeof renderList>>['store'];
// By id: adding a window also moves its session up the list.
const windowCounts = (store: Store) =>
  Object.fromEntries(
    store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => [
        g.tabGroupId,
        g.windows.length,
      ])
  );

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('an unselected row', () => {
  test('popup: the action row Open · Switch · Replace, then Add current window above the list', async () => {
    await renderList();
    fireEvent.contextMenu(rowOf('Bravo'));

    const row = actionRow();
    if (row === null) throw new Error('no action row');
    const buttons = within(row).getAllByRole('menuitem');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'reopen_windowOpen',
      'filter_center_focusSwitch',
      'browser_updatedReplace',
    ]);
    // Named by the short label, described and tooltipped by the long one, as the row's own buttons.
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open',
      'Switch',
      'Replace',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-description'))).toEqual([
      'Open session, keeping current windows',
      'Close current windows and open this session',
      'Replace this session with open windows',
    ]);
    expect(buttons.map((b) => b.getAttribute('data-tooltip'))).toEqual([
      'Open session, keeping current windows',
      'Close current windows and open this session',
      'Replace this session with open windows',
    ]);
    expect(keys()).toEqual([
      'open',
      'switch',
      'replace',
      'add',
      'copy',
      'rename',
      'export',
      'delete',
    ]);
    expect(item('Add current window to this session')).toBeTruthy();
  });

  test('full view: no Switch', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderList(twoTabs, false);
    fireEvent.contextMenu(rowOf('Bravo'));

    expect(actionRowNames()).toEqual(['Open', 'Replace']);
  });

  test('Open, Switch and Replace act on the right-clicked session and leave the selection alone', async () => {
    const { actions, store } = await renderList();
    const argOf = (type: string) =>
      actions
        .filter((a) => a.type === type)
        .map((a) =>
          'meta' in a && typeof a.meta === 'object' && a.meta !== null
            ? Reflect.get(a.meta, 'arg')
            : undefined
        );

    for (const name of ['Open', 'Switch', 'Replace']) {
      fireEvent.contextMenu(rowOf('Bravo'));
      fireEvent.click(item(name));
    }

    expect(argOf('global/openAllTabContainer/pending')).toEqual([
      { tabGroupId: 'S2', goToURLText: 'Visit Site' },
    ]);
    expect(argOf('global/requestFocusTabContainer/pending')).toEqual([
      expect.objectContaining({ tabGroupId: 'S2' }),
    ]);
    expect(argOf('global/replaceSessionWithOpenWindows/pending')).toEqual([
      'S2',
    ]);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    expect(document.querySelector('[data-row-menu]')).toBeNull();
  });

  test('Add current window shows that session, then adds the window, so the toast is true', async () => {
    const { store, actions } = await renderList();
    const before = actions.length;
    fireEvent.contextMenu(rowOf('Bravo'));
    fireEvent.click(item('Add current window to this session'));

    await waitFor(() => expect(windowCounts(store)).toEqual({ S1: 1, S2: 2 }));
    const state = store.getState();
    expect(state.tabContainerDataState.selectedTabGroupId).toBe('S2');
    // Shown before the add lands, never after.
    const types = actions.slice(before).map((a) => a.type);
    const shownAt = types.indexOf(selectTabContainer.type);
    expect(shownAt).toBeGreaterThanOrEqual(0);
    expect(shownAt).toBeLessThan(
      types.indexOf(ADD_CURR_WINDOW_TO_TABGROUP_ACTION)
    );
    expect(state.globalState.toasts.map((t) => t.text)).toContain(
      TOAST_MESSAGES.ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS
    );
  });

  test('worst path: Tab Keeper alone in its window, Add does nothing at all, the selection included', async () => {
    const { store, seen } = await renderList(onlyTabKeeper);
    fireEvent.contextMenu(rowOf('Bravo'));
    fireEvent.click(item('Add current window to this session'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(seen).not.toContain(ADD_CURR_WINDOW_TO_TABGROUP_ACTION);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    expect(windowCounts(store)).toEqual({ S1: 1, S2: 1 });
  });
});

describe('the selected row', () => {
  test('popup: the same action row as any other row, then Add current window', async () => {
    await renderList();
    fireEvent.contextMenu(rowOf('Trip'));

    expect(actionRowNames()).toEqual(['Open', 'Switch', 'Replace']);
    expect(keys()).toEqual([
      'open',
      'switch',
      'replace',
      'add',
      'copy',
      'rename',
      'export',
      'delete',
    ]);
  });

  test('its Open acts on it', async () => {
    const { actions } = await renderList();
    fireEvent.contextMenu(rowOf('Trip'));
    fireEvent.click(item('Open'));

    expect(
      actions
        .filter((a) => a.type === 'global/openAllTabContainer/pending')
        .map((a) => ('meta' in a ? Reflect.get(Object(a.meta), 'arg') : null))
    ).toEqual([{ tabGroupId: 'S1', goToURLText: 'Visit Site' }]);
  });

  test('full view, unfolded: Open · Replace, as the row has', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderList(twoTabs, false);
    fireEvent.contextMenu(rowOf('Trip'));

    expect(actionRowNames()).toEqual(['Open', 'Replace']);
  });

  test('its Add adds to it and keeps it shown', async () => {
    const { store } = await renderList();
    fireEvent.contextMenu(rowOf('Trip'));
    fireEvent.click(item('Add current window to this session'));

    await waitFor(() => expect(windowCounts(store)).toEqual({ S1: 2, S2: 1 }));
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
  });

  test('full view, folded: the selected row is not drawn selected, so it gets the action row too', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderList(twoTabs, true);
    fireEvent.contextMenu(rowOf('Trip'));

    expect(actionRowNames()).toEqual(['Open', 'Replace']);
  });
});

describe('keyboard', () => {
  const focused = () =>
    document.activeElement?.getAttribute('aria-label') ??
    document.activeElement?.getAttribute('data-menu-item');
  const press = (key: string) => {
    const el = document.activeElement;
    if (el === null) throw new Error('nothing focused');
    fireEvent.keyDown(el, { key });
  };

  test('←/→ walk the row, ↓/↑ move between the row and the list, both wrap', async () => {
    await renderList();
    fireEvent.keyDown(rowOf('Bravo'), { key: 'F10', shiftKey: true });

    expect(focused()).toBe('Open');
    press('ArrowRight');
    expect(focused()).toBe('Switch');
    press('ArrowRight');
    expect(focused()).toBe('Replace');
    press('ArrowRight');
    expect(focused()).toBe('Open');
    press('ArrowLeft');
    expect(focused()).toBe('Replace');

    press('ArrowDown');
    expect(focused()).toBe('add');
    // ←/→ in the list stay put.
    press('ArrowRight');
    expect(focused()).toBe('add');
    press('ArrowDown');
    expect(focused()).toBe('copy');
    press('ArrowUp');
    press('ArrowUp');
    expect(focused()).toBe('Open');
    press('ArrowUp');
    expect(focused()).toBe('delete');
    press('ArrowDown');
    expect(focused()).toBe('Open');
  });

  test('Enter on a row button runs it; Esc closes', async () => {
    const { actions } = await renderList();
    fireEvent.keyDown(rowOf('Bravo'), { key: 'F10', shiftKey: true });
    press('ArrowLeft');
    expect(focused()).toBe('Replace');
    await userEvent.keyboard('{Enter}');

    expect(
      actions.some(
        (a) => a.type === 'global/replaceSessionWithOpenWindows/pending'
      )
    ).toBe(true);
    expect(document.querySelector('[data-row-menu]')).toBeNull();

    fireEvent.keyDown(rowOf('Bravo'), { key: 'F10', shiftKey: true });
    press('Escape');
    expect(document.querySelector('[data-row-menu]')).toBeNull();
  });
});

describe('the header', () => {
  const renderHeader = () =>
    renderWithProviders(<HeroContainerRight />, {
      seed: twoTabs,
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([S1, S2])));
        store.dispatch(selectTabContainer('S1'));
      },
    });

  test('its right-click leads with Open · Switch · Replace and has no Add current window: the Add chip sits beside it', async () => {
    await renderHeader();
    fireEvent.contextMenu(screen.getAllByText('Trip')[0]);

    expect(actionRowNames()).toEqual(['Open', 'Switch', 'Replace']);
    expect(keys()).toEqual([
      'open',
      'switch',
      'replace',
      'copy',
      'rename',
      'export',
      'delete',
    ]);
  });

  test('its ⋮ has no action row and no Add current window', async () => {
    await renderHeader();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu');

    expect(menu.querySelector('[data-menu-action-row]')).toBeNull();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.getAttribute('data-menu-item'))
    ).toEqual(['copy', 'rename', 'export', 'delete']);
  });

  // KAN-805. Rename session, right after Copy all links, opens the title with the cursor in it.
  test('its ⋮ Rename session opens the title field', async () => {
    const user = userEvent.setup();
    await renderHeader();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Rename session',
      })
    );

    const field = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[data-tour-anchor="title"]'
      );
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(field).toHaveValue('Trip');
    expect(field).toHaveFocus();
  });
  // After an Esc, whose blur commits nothing, the menu's Rename still saves what is typed.
  test('after an Esc on the title, its ⋮ Rename session still saves', async () => {
    const user = userEvent.setup();
    const { store } = await renderHeader();
    await user.click(
      screen.getByRole('button', { name: 'Rename session: Trip' })
    );
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        document.querySelector('input[data-tour-anchor="title"]')
      ).toBeNull()
    );

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Rename session',
      })
    );
    const field = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[data-tour-anchor="title"]'
      );
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    await user.clear(field);
    await user.type(field, 'Kyoto{Enter}');

    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'S1')
        ?.title
    ).toBe('Kyoto');
  });
});

// KAN-805. A row's Rename shows that session first, as a click on the row does, then opens its title.
describe('Rename session from a row', () => {
  const renderBoth = (folded = false) =>
    renderWithProviders(
      <>
        <TabGroupEntryContainer />
        <HeroContainerRight />
      </>,
      {
        seed: twoTabs,
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([S1, S2])));
          store.dispatch(selectTabContainer('S1'));
          store.dispatch(setFoldSavedSessionInTabView(folded));
        },
      }
    );

  test('selects the right-clicked session and opens its title, cursor in it', async () => {
    const { store } = await renderBoth();
    fireEvent.contextMenu(rowOf('Bravo'));
    fireEvent.click(
      within(rowMenu()).getByRole('menuitem', { name: 'Rename session' })
    );

    await waitFor(() =>
      expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
        'S2'
      )
    );
    const field = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[data-tour-anchor="title"]'
      );
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(field).toHaveValue('Bravo');
    expect(field).toHaveFocus();
  });

  // Off the happy path: a request the header cannot honour now is dropped, not kept for later.
  test('a request for a session not on screen is dropped, and selecting it later opens nothing', async () => {
    const { store } = await renderBoth();
    act(() => {
      store.dispatch(requestSessionRename('S2'));
    });
    await waitFor(() =>
      expect(store.getState().globalState.sessionRenameRequest).toBeNull()
    );

    act(() => {
      store.dispatch(selectTabContainer('S2'));
    });
    expect(
      await screen.findByRole('button', { name: 'Rename session: Bravo' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('input[data-tour-anchor="title"]')
    ).toBeNull();
  });

  test('a request for a session no longer listed is dropped', async () => {
    const { store } = await renderBoth();
    act(() => {
      store.dispatch(requestSessionRename('gone'));
    });
    await waitFor(() =>
      expect(store.getState().globalState.sessionRenameRequest).toBeNull()
    );
    expect(
      document.querySelector('input[data-tour-anchor="title"]')
    ).toBeNull();
  });

  test('full view, folded: peeks the saved session first, as a row click does', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = await renderBoth(true);
    fireEvent.contextMenu(rowOf('Bravo'));
    fireEvent.click(
      within(rowMenu()).getByRole('menuitem', { name: 'Rename session' })
    );

    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
  });
});
