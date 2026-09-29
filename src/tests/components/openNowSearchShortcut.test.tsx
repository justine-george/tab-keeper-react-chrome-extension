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

// KAN-330 O14b, R1. The / key focuses Open now's search; with the rail
// showing it opens the drawer first.

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

describe('/ focuses the search (O14b)', () => {
  test('side by side: / on the page focuses the field and types nothing', async () => {
    installMatchMedia(false);
    await renderHome(false);
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
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
    act(() => field().blur());
    fireEvent.keyDown(document.body, { key: '/' });
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 5]);
  });

  test('/ in the name box types a slash there', async () => {
    installMatchMedia(false);
    await renderHome(false);
    const nameBox = screen.getByPlaceholderText<HTMLInputElement>(
      'Save all open windows as a session'
    );
    const user = userEvent.setup();
    await user.type(nameBox, 'a/b');
    // The box fills in a suggested name on focus, so the slash is checked by
    // where it landed, not by the whole value.
    expect(nameBox.value).toMatch(/a\/b$/);
    expect(document.activeElement).toBe(nameBox);
  });

  test('R1: with the rail showing, / opens the drawer with focus in the field', async () => {
    installMatchMedia(true);
    await renderHome(false);
    const button = await railButton();
    fireEvent.keyDown(document.body, { key: '/' });
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
