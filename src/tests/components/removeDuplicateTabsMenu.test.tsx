import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-609 (picks 1A, 5A). The ⋮ menu offers Remove duplicate tabs, between
// Export and Delete, only while the session on screen has a duplicate.

const tab = (tabId: string, url: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url,
});
const withTabs = (tabs: tabData[]) =>
  buildSession({
    tabGroupId: 'session-kyoto',
    title: 'Weekend in Kyoto',
    tabCount: tabs.length,
    windows: [
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
    ],
  });

const A = 'https://a.test/';
const B = 'https://b.test/';

const renderHeader = (tabs: tabData[]) =>
  renderWithProviders(<HeroContainerRight />, {
    seed: { windows: [{ id: 1 }] },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([withTabs(tabs)])));
      store.dispatch(
        setPresentStartup({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    },
  });

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
};

const itemNames = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('aria-label') ?? i.textContent);

describe('Remove duplicate tabs in the session menu (KAN-609)', () => {
  test('sits between Export and Delete, with the count', async () => {
    const user = userEvent.setup();
    await renderHeader([
      tab('t1', A),
      tab('t2', B),
      tab('t3', A),
      tab('t4', A),
    ]);
    const menu = await openMenu(user);
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toEqual([
      within(menu).getByRole('menuitem', { name: 'Copy all links' }),
      within(menu).getByRole('menuitem', { name: 'Export…' }),
      within(menu).getByRole('menuitem', { name: 'Remove 2 duplicate tabs' }),
      within(menu).getByRole('menuitem', { name: /^Delete session/ }),
    ]);
  });

  test('says "tab" for one', async () => {
    const user = userEvent.setup();
    await renderHeader([tab('t1', A), tab('t2', A)]);
    const menu = await openMenu(user);
    expect(
      within(menu).queryByRole('menuitem', { name: 'Remove 1 duplicate tab' })
    ).not.toBeNull();
  });

  test('draws stack_off', async () => {
    const user = userEvent.setup();
    await renderHeader([tab('t1', A), tab('t2', A)]);
    const menu = await openMenu(user);
    const item = within(menu).getByRole('menuitem', {
      name: 'Remove 1 duplicate tab',
    });
    expect(item.textContent).toContain('stack_off');
  });

  test('is not offered when every address is different', async () => {
    const user = userEvent.setup();
    await renderHeader([tab('t1', A), tab('t2', B)]);
    const menu = await openMenu(user);
    expect(itemNames(menu)).toHaveLength(3);
    expect(
      within(menu).queryByRole('menuitem', { name: /duplicate/ })
    ).toBeNull();
  });

  test('choosing it removes the copies and announces it with Undo', async () => {
    const user = userEvent.setup();
    const { store } = await renderHeader([
      tab('t1', A),
      tab('t2', B),
      tab('t3', A),
    ]);
    const menu = await openMenu(user);
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Remove 1 duplicate tab' })
    );
    const [session] = store.getState().tabContainerDataState.tabGroups;
    expect(session.windows[0].tabs.map((t) => t.tabId)).toEqual(['t1', 't2']);
    expect(newestToast(store.getState())).toMatchObject({
      text: TOAST_MESSAGES.DUPLICATE_TABS_REMOVED,
      params: { count: 1 },
      offersUndo: true,
    });
  });
});
