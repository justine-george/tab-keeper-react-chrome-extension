import { describe, expect, test } from 'vitest';
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
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-708 (Task 12). Right-clicking the saved session header opens that header's ⋮ items.

const SHOWN = buildSession({ tabGroupId: 'shown', title: 'Roadmap' });
const OTHER = buildSession({ tabGroupId: 'other', title: 'Kyoto' });

function Both() {
  return (
    <>
      <TabGroupEntryContainer />
      <HeroContainerRight />
    </>
  );
}

const renderBoth = () =>
  renderWithProviders(<Both />, {
    seed: { platformOs: 'mac', windows: [{ id: 1 }] },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SHOWN, OTHER])));
      store.dispatch(selectTabContainer('shown'));
    },
  });

const rowMenus = () => [
  ...document.querySelectorAll<HTMLElement>('[data-row-menu]'),
];
const labels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('aria-label') ?? i.textContent);
const header = () => {
  const el = document.querySelector<HTMLElement>('[data-new-window-target]')
    ?.parentElement?.parentElement;
  if (el === null || el === undefined) throw new Error('no header');
  return el;
};
const title = () => within(header()).getByText('Roadmap');
const dots = () => screen.getByRole('button', { name: 'More actions' });

describe('right-clicking the session header (KAN-708)', () => {
  test('the title offers exactly the header ⋮’s items, in order, and Chrome’s menu is suppressed', async () => {
    const user = userEvent.setup();
    await renderBoth();

    expect(fireEvent.contextMenu(title())).toBe(false);
    expect(rowMenus()).toHaveLength(1);
    expect(rowMenus()[0]).toHaveAccessibleName('More actions: Roadmap');
    const rightClickItems = labels(rowMenus()[0]);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(rowMenus()).toHaveLength(0);

    await user.click(dots());
    const dotItems = labels(screen.getByRole('menu', { name: 'More actions' }));
    expect(rightClickItems).toEqual(dotItems);
    expect(rightClickItems.length).toBeGreaterThanOrEqual(3);
  });

  test('the Open button gives the same menu', async () => {
    await renderBoth();
    const open = header().querySelector('[data-tour-anchor="open"] *');
    if (open === null) throw new Error('no Open button');
    expect(fireEvent.contextMenu(open)).toBe(false);
    expect(rowMenus()).toHaveLength(1);
    expect(labels(rowMenus()[0]).length).toBeGreaterThanOrEqual(3);
  });

  test('Delete session deletes the header’s session', async () => {
    const { store } = await renderBoth();
    fireEvent.contextMenu(title());
    fireEvent.click(
      within(rowMenus()[0]).getByRole('menuitem', { name: /^Delete session/ })
    );
    await waitFor(() =>
      expect(
        store
          .getState()
          .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
      ).toEqual(['other'])
    );
  });

  test('while searching, Chrome’s menu stays and nothing opens', async () => {
    const { store } = await renderBoth();
    act(() => {
      store.dispatch(setSearchInputText('Roadmap'));
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    );
    expect(fireEvent.contextMenu(title())).toBe(true);
    expect(rowMenus()).toHaveLength(0);
  });

  test('the rename field keeps Chrome’s menu', async () => {
    const user = userEvent.setup();
    await renderBoth();
    await user.click(
      within(header()).getByRole('button', { name: 'Rename session' })
    );
    const field = within(header()).getByRole('textbox');
    expect(fireEvent.contextMenu(field)).toBe(true);
    expect(rowMenus()).toHaveLength(0);
  });

  test('with the header ⋮ open, a right-click on the title leaves one menu', async () => {
    const user = userEvent.setup();
    await renderBoth();
    await user.click(dots());
    expect(screen.getAllByRole('menu')).toHaveLength(1);

    fireEvent.mouseDown(title(), { button: 2 });
    fireEvent.contextMenu(title(), { clientX: 5, clientY: 5 });

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(rowMenus()).toHaveLength(1);
  });

  test('with a left-pane row’s menu open, a right-click on the header leaves only the header’s', async () => {
    await renderBoth();
    const list = document.querySelector<HTMLElement>('[data-session-column]');
    if (list === null) throw new Error('no session list');
    fireEvent.contextMenu(within(list).getByRole('button', { name: /^Kyoto/ }));
    expect(rowMenus()[0]).toHaveAccessibleName('More actions: Kyoto');

    fireEvent.contextMenu(title());

    expect(rowMenus()).toHaveLength(1);
    expect(rowMenus()[0]).toHaveAccessibleName('More actions: Roadmap');
  });

  test('empty space outside the header keeps Chrome’s menu', async () => {
    await renderBoth();
    expect(fireEvent.contextMenu(document.body)).toBe(true);
    expect(rowMenus()).toHaveLength(0);
  });
});
