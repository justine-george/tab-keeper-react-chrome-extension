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

const RAIL_NAME = 'Currently open, 3 Tabs';

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

describe('/ focuses the search (O14b)', () => {
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
    // A real press: it chooses Currently open (KAN-800).
    await userEvent.setup().click(button);
    const drawer = drawerOf(button);
    const inside = within(drawer).getByRole('heading', {
      name: 'Currently open',
    });
    inside.focus();
    fireEvent.keyDown(inside, { key: '/' });
    expect(document.activeElement).toBe(field());
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

  // The rail listens for / only while the drawer is closed. Were it to hear a
  // / pressed inside the open drawer, it would note "opened by the shortcut"
  // for an opening that never happens, and the NEXT opening by the button
  // would put the cursor in the field instead of on the heading (O2).
  test('/ inside the open drawer does not change where the next button opening lands', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    const user = userEvent.setup();
    await user.click(button);
    const drawer = drawerOf(button);
    const heading = within(drawer).getByRole('heading', {
      name: 'Currently open',
    });
    // PREMISE: opened by the button, focus is on the heading.
    expect(document.activeElement).toBe(heading);

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
      within(drawerOf(button)).getByRole('heading', { name: 'Currently open' })
    );
  });

  test('the text survives closing and reopening the drawer', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    fireEvent.click(button);
    await userEvent.setup().type(field(), 'b');
    fireEvent.click(
      screen.getByRole('button', { name: 'Close the Currently open panel' })
    );
    fireEvent.click(button);
    expect(field()).toHaveValue('b');
  });
});

// KAN-800 (pick A). The / chip, and aria-keyshortcuts with it, show only where / goes now.
const chipOn = (input: HTMLElement) => {
  const row = input.closest('[data-saved-search], [data-open-now-search]');
  if (row === null) throw new Error('no search row');
  return (
    input.getAttribute('aria-keyshortcuts') === '/' &&
    within(row as HTMLElement).queryByText('/') !== null
  );
};
const paneOf = (name: string) => {
  const el = document.querySelector<HTMLElement>(`[data-pane="${name}"]`);
  if (el === null) throw new Error(`no ${name} pane`);
  return el;
};

describe('the / chip shows where / goes (KAN-800)', () => {
  test('first open: on the saved field only', async () => {
    installMatchMedia(false);
    await renderHome(false);
    await screen.findByRole('textbox', { name: 'Search open tabs' });
    expect(chipOn(savedField())).toBe(true);
    expect(chipOn(field())).toBe(false);
    expect(field()).not.toHaveAttribute('aria-keyshortcuts');
  });

  test('a press on Currently open’s empty space moves it there, and / follows; a press on the saved list moves it back', async () => {
    installMatchMedia(false);
    await renderHome(false);
    await screen.findByRole('textbox', { name: 'Search open tabs' });
    const user = userEvent.setup();

    fireEvent.pointerDown(paneOf('open-now'));
    expect(chipOn(field())).toBe(true);
    expect(chipOn(savedField())).toBe(false);
    await user.keyboard('/');
    expect(document.activeElement).toBe(field());

    await user.keyboard('{Escape}');
    fireEvent.pointerDown(paneOf('sessions'));
    expect(chipOn(savedField())).toBe(true);
    expect(chipOn(field())).toBe(false);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('/');
    expect(document.activeElement).toBe(savedField());
  });

  test('a typed search swaps the chip for Clear on that field only', async () => {
    installMatchMedia(false);
    await renderHome(false);
    const user = userEvent.setup();
    await user.type(savedField(), 'k');
    expect(
      within(
        savedField().closest('[data-saved-search]') as HTMLElement
      ).queryByText('/')
    ).toBeNull();
    expect(chipOn(field())).toBe(false);
  });

  test('rail: the drawer’s field wears it while open; closed by Esc, the rail wears it and / opens the drawer into its search', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    expect(within(button).queryByText('/')).toBeNull();
    expect(button).not.toHaveAttribute('aria-keyshortcuts');

    const user = userEvent.setup();
    await user.click(button);
    expect(chipOn(field())).toBe(true);
    expect(chipOn(savedField())).toBe(false);
    // One chip: the rail drops its own while the drawer is open.
    expect(within(button).queryByText('/')).toBeNull();
    expect(button).not.toHaveAttribute('aria-keyshortcuts');

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(button);
    expect(within(button).queryByText('/')).not.toBeNull();
    expect(button).toHaveAttribute('aria-keyshortcuts', '/');
    expect(chipOn(savedField())).toBe(false);

    await user.keyboard('/');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(field());
  });

  test('rail: a press on the saved list closes the drawer and sends / there, though the rail takes focus back', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    const user = userEvent.setup();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await user.pointer({ keys: '[MouseLeft]', target: paneOf('sessions') });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // The drawer hands focus to the rail after the press (KAN-682).
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(button);
    expect(chipOn(savedField())).toBe(true);
    expect(within(button).queryByText('/')).toBeNull();

    await user.keyboard('/');
    expect(document.activeElement).toBe(savedField());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
