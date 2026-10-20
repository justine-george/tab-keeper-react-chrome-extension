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
import { classRulesFor } from '../setup/hoverRules';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  selectTabContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-708. Right-clicking a session row opens that session's ⋮ items at the pointer, and
// touches nothing else: no selection, no right pane switch.

const tab = (tabId: string, url: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url,
});
const oneWindow = (tabs: tabData[]) => [
  {
    windowId: 'window-1',
    windowHeight: 1080,
    windowWidth: 1920,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: tabs.length,
    title: 'Morning reading',
    tabs,
  },
];

const SHOWN = buildSession({ tabGroupId: 'shown', title: 'Roadmap' });
const KYOTO = buildSession({
  tabGroupId: 'kyoto',
  title: 'Kyoto',
  tabCount: 2,
  windows: oneWindow([
    tab('k1', 'https://a.test/'),
    tab('k2', 'https://a.test/'),
  ]),
});

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
      store.dispatch(replaceState(buildContainer([SHOWN, KYOTO])));
      store.dispatch(selectTabContainer('shown'));
    },
  });

type Store = Awaited<ReturnType<typeof renderBoth>>['store'];
const ids = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
const selected = (store: Store) =>
  store.getState().tabContainerDataState.selectedTabGroupId;
// Scoped to the list: the header shows the selected session's title as a button too.
const rowButton = (title: string) => {
  const list = document.querySelector<HTMLElement>('[data-session-column]');
  if (list === null) throw new Error('no session list');
  return within(list).getByRole('button', { name: new RegExp(`^${title}`) });
};
const rowMenus = () => [
  ...document.querySelectorAll<HTMLElement>('[data-row-menu]'),
];
const labels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('aria-label') ?? i.textContent);

describe('right-clicking a session row (KAN-708)', () => {
  test('a session that is not selected offers the header ⋮’s items in order', async () => {
    const user = userEvent.setup();
    await renderBoth();

    // The header ⋮ is for Roadmap; make it show Kyoto's items by selecting Kyoto first.
    fireEvent.contextMenu(rowButton('Kyoto'));
    const rowItems = labels(rowMenus()[0]);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(rowMenus()).toHaveLength(0);

    await user.click(rowButton('Kyoto'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const headerItems = labels(screen.getByRole('menu', { name: /./ }));

    expect(rowItems).toEqual(headerItems);
    expect(rowItems.length).toBeGreaterThanOrEqual(4);
  });

  test('the menu is named for the session', async () => {
    await renderBoth();
    fireEvent.contextMenu(rowButton('Kyoto'));
    expect(rowMenus()[0]).toHaveAccessibleName('More actions: Kyoto');
  });

  test('the right pane does not switch, on the right-click or on Escape', async () => {
    const { store } = await renderBoth();

    fireEvent.contextMenu(rowButton('Kyoto'));
    expect(selected(store)).toBe('shown');
    expect(rowMenus()).toHaveLength(1);

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(rowMenus()).toHaveLength(0);
    expect(selected(store)).toBe('shown');
  });

  test('Delete removes the right-clicked session, not the selected one, and the selection stays', async () => {
    const { store } = await renderBoth();

    fireEvent.contextMenu(rowButton('Kyoto'));
    fireEvent.click(
      within(rowMenus()[0]).getByRole('menuitem', { name: /^Delete session/ })
    );

    await waitFor(() => expect(ids(store)).toEqual(['shown']));
    expect(selected(store)).toBe('shown');
  });

  test('⌫ with the menu open deletes the right-clicked session', async () => {
    const { store } = await renderBoth();

    fireEvent.contextMenu(rowButton('Kyoto'));
    fireEvent.keyDown(within(rowMenus()[0]).getAllByRole('menuitem')[0], {
      key: 'Backspace',
    });

    await waitFor(() => expect(ids(store)).toEqual(['shown']));
    expect(selected(store)).toBe('shown');
  });

  test('Remove duplicates appears only for a session that has them', async () => {
    const { store } = await renderBoth();

    fireEvent.contextMenu(rowButton('Roadmap'));
    expect(labels(rowMenus()[0])).not.toContain('Remove 1 duplicate tab');
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });

    fireEvent.contextMenu(rowButton('Kyoto'));
    const menu = rowMenus()[0];
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Remove 1 duplicate tab' })
    );
    const kyoto = store
      .getState()
      .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'kyoto');
    expect(kyoto?.windows[0].tabs).toHaveLength(1);
  });

  test('while searching, Chrome’s menu stays', async () => {
    const { store } = await renderBoth();
    act(() => {
      store.dispatch(setSearchInputText('Kyoto'));
    });
    await waitFor(() => expect(rowButton('Kyoto')).toBeTruthy());
    const button = rowButton('Kyoto');

    expect(fireEvent.contextMenu(button)).toBe(true);
    expect(rowMenus()).toHaveLength(0);
  });

  test('the session is removed by the store while its menu is open: the menu closes', async () => {
    const { store } = await renderBoth();
    fireEvent.contextMenu(rowButton('Kyoto'));
    expect(rowMenus()).toHaveLength(1);

    act(() => {
      store.dispatch(replaceState(buildContainer([SHOWN])));
      store.dispatch(selectTabContainer('shown'));
    });

    await waitFor(() => expect(rowMenus()).toHaveLength(0));
  });
});

describe('the held session row (KAN-708, 5B)', () => {
  const rowOf = (title: string) => {
    const el = rowButton(title).closest('[data-drag-handle-row]');
    if (el === null) throw new Error(`no row for ${title}`);
    return el;
  };
  const rulesLike = (el: Element, pseudo: string) =>
    classRulesFor(el)
      .split('\n')
      .filter((r) => r.includes(pseudo))
      .map((r) => r.replace(pseudo, '@'))
      .sort();

  test('the held row carries data-row-menu-held and the others do not', async () => {
    await renderBoth();
    fireEvent.contextMenu(rowButton('Kyoto'));

    expect(rowOf('Kyoto')).toHaveAttribute('data-row-menu-held');
    expect(rowOf('Roadmap')).not.toHaveAttribute('data-row-menu-held');

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(rowOf('Kyoto')).not.toHaveAttribute('data-row-menu-held');
  });

  test.each(['Roadmap', 'Kyoto'])(
    'held draws exactly what hover draws, so the selected row (%s) keeps its own look',
    async (title) => {
      await renderBoth();
      const row = rowOf(title);
      const hover = rulesLike(row, ':hover');
      const held = rulesLike(row, '[data-row-menu-held]');

      expect(hover.length).toBeGreaterThan(0);
      expect(held).toEqual(hover);
    }
  );

  test('the selected and the unselected row are told apart by hover, and held follows each', async () => {
    await renderBoth();
    const selectedHeld = rulesLike(rowOf('Roadmap'), '[data-row-menu-held]');
    const otherHeld = rulesLike(rowOf('Kyoto'), '[data-row-menu-held]');
    // The unselected row also fills; the selected one does not.
    expect(otherHeld.join('\n')).not.toEqual(selectedHeld.join('\n'));
  });
});
