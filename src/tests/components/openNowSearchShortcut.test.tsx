import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-330 O14b, R1; K1. The / key focuses the search of the pane holding
// focus: Open now's, opening the drawer first when the rail shows, else the
// saved list's.

const RAIL_NAME = 'Open now, 3 Tabs';

// Two windows, three tabs.
const twoWindows = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ title: 'A', url: 'https://a.test/', active: true }],
    },
    {
      id: 2,
      focused: false,
      tabs: [
        { title: 'B', url: 'https://b.test/', active: false },
        { title: 'C', url: 'https://c.test/', active: true },
      ],
    },
  ],
});

// The rail's query as the page sees it. Every other query answers false.
let railQuery: FakeMediaQueryList;

function installMatchMedia(narrow: boolean) {
  railQuery = new FakeMediaQueryList(OPEN_NOW_RAIL_QUERY, narrow);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query === OPEN_NOW_RAIL_QUERY
      ? railQuery
      : new FakeMediaQueryList(query, false)
  );
}

const renderHome = (fold: boolean) =>
  renderWithProviders(<MainContainer />, {
    seed: twoWindows(),
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(fold));
    },
  });

const railButton = () => screen.findByRole('button', { name: RAIL_NAME });

// The drawer the rail button says it controls.
function drawerOf(button: HTMLElement): HTMLElement {
  const id = button.getAttribute('aria-controls');
  if (id === null) throw new Error('rail button controls nothing');
  const drawer = document.getElementById(id);
  if (drawer === null) throw new Error(`no element #${id}`);
  return drawer;
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
});

const field = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: 'Search open tabs' });
const savedField = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: 'Search saved tabs' });
const aLiveTab = async () =>
  (await screen.findAllByRole('button', { name: /^Switch to tab: / }))[0];

describe('/ focuses the search (O14b)', () => {
  test('side by side: / from an Open now tab focuses its field and types nothing', async () => {
    installMatchMedia(false);
    await renderHome(false);
    (await aLiveTab()).focus();
    // A real keypress: user-event types the character into whatever holds
    // focus once the keydown is done, unless the keydown was cancelled.
    await userEvent.setup().keyboard('/');
    expect(document.activeElement).toBe(field());
    expect(field()).toHaveValue('');
  });

  test('/ selects text already in the field', async () => {
    installMatchMedia(false);
    await renderHome(false);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Search open tabs' }),
      'kyoto'
    );
    // The text hides every tab, so focus the column itself.
    const column = field().closest<HTMLElement>('[data-pane="open-now"]');
    if (column === null) throw new Error('no Open now column');
    column.tabIndex = -1;
    column.focus();
    fireEvent.keyDown(column, { key: '/' });
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 5]);
  });

  test('K1: / from the page focuses the saved field and selects its text', async () => {
    installMatchMedia(false);
    await renderHome(false);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Search saved tabs' }),
      'kyoto'
    );
    act(() => savedField().blur());
    await user.keyboard('/');
    expect(document.activeElement).toBe(savedField());
    expect([savedField().selectionStart, savedField().selectionEnd]).toEqual([
      0, 5,
    ]);
    expect(savedField()).toHaveValue('kyoto');
  });

  test('K1: with the rail showing, / from the page goes to the saved field and the drawer stays shut', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    await userEvent.setup().keyboard('/');
    expect(document.activeElement).toBe(savedField());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('K1: / from inside the open drawer goes to Open now, not the saved list', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    fireEvent.click(button);
    const drawer = drawerOf(button);
    const inside = within(drawer).getByRole('heading', { name: 'Open now' });
    inside.focus();
    fireEvent.keyDown(inside, { key: '/' });
    expect(document.activeElement).toBe(field());
  });

  test('K1: / in the saved field types a slash there and Open now is untouched', async () => {
    installMatchMedia(false);
    await renderHome(false);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Search saved tabs' }),
      'a/b'
    );
    expect(savedField()).toHaveValue('a/b');
    expect(document.activeElement).toBe(savedField());
    expect(field()).toHaveValue('');
  });

  test("K1: / in Open now's field types a slash there and the saved field is untouched", async () => {
    installMatchMedia(false);
    await renderHome(false);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Search open tabs' }),
      'a/b'
    );
    expect(field()).toHaveValue('a/b');
    expect(document.activeElement).toBe(field());
    expect(savedField()).toHaveValue('');
  });

  test('K1: in the popup, where Open now is not mounted, / focuses the saved field', async () => {
    history.replaceState(null, '', '/');
    await renderHome(false);
    await screen.findByRole('textbox', { name: 'Search saved tabs' });
    expect(
      screen.queryByRole('textbox', { name: 'Search open tabs' })
    ).toBeNull();
    await userEvent.setup().keyboard('/');
    expect(document.activeElement).toBe(savedField());
  });

  test('/ in the name box types a slash there', async () => {
    installMatchMedia(false);
    await renderHome(false);
    const nameBox = screen.getByPlaceholderText<HTMLInputElement>(
      'Name the new session'
    );
    const user = userEvent.setup();
    await user.type(nameBox, 'a/b');
    expect(nameBox.value).toBe('a/b');
    expect(document.activeElement).toBe(nameBox);
  });

  test('R1: with the rail showing, / opens the drawer with focus in the field', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    button.focus();
    fireEvent.keyDown(button, { key: '/' });
    const drawer = drawerOf(button);
    expect(document.activeElement).toBe(
      within(drawer).getByRole('textbox', { name: 'Search open tabs' })
    );
  });

  test('Esc in the drawer clears first, closes second, and focus returns to the rail button', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    fireEvent.click(button);
    const user = userEvent.setup();
    await user.type(
      within(drawerOf(button)).getByRole('textbox', {
        name: 'Search open tabs',
      }),
      'b'
    );
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(button);
  });

  // The rail listens for / only while the drawer is closed. Were it to hear a
  // / pressed inside the open drawer, it would note "opened by the shortcut"
  // for an opening that never happens, and the NEXT opening by the button
  // would put the cursor in the field instead of on the heading (O2).
  test('/ inside the open drawer does not change where the next button opening lands', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    fireEvent.click(button);
    const drawer = drawerOf(button);
    const heading = within(drawer).getByRole('heading', { name: 'Open now' });
    // PREMISE: opened by the button, focus is on the heading.
    expect(document.activeElement).toBe(heading);

    const user = userEvent.setup();
    await user.keyboard('/');
    expect(document.activeElement).toBe(field());
    expect(field()).toHaveValue('');
    expect(button).toHaveAttribute('aria-expanded', 'true');

    // Empty, so Esc closes, and focus goes back to the rail button.
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(document.activeElement).toBe(
      within(drawerOf(button)).getByRole('heading', { name: 'Open now' })
    );
  });

  test('the text survives closing and reopening the drawer', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    fireEvent.click(button);
    await userEvent.setup().type(field(), 'b');
    fireEvent.click(screen.getByRole('button', { name: 'Close Open now' }));
    fireEvent.click(button);
    expect(field()).toHaveValue('b');
  });
});
