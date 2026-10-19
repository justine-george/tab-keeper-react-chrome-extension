import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { RootState } from '../../redux/store';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-694. A saved window's ⋮ offers Sort tabs by site first, only while the
// sort would change the order.

const tab = (
  tabId: string,
  host: string,
  extra: Partial<tabData> = {}
): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${host}/${tabId}`,
  ...extra,
});

const render = (tabs: tabData[]) =>
  renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({
            tabGroupId: 'lisbon',
            title: 'Lisbon trip',
            windowCount: 1,
            tabCount: tabs.length,
            windows: [
              {
                windowId: 'w1',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: tabs.length,
                title: 'Planning',
                chromeTabGroups: [
                  { groupId: 'g1', title: 'Research', color: 'blue' },
                ],
                tabs,
              },
            ],
          })
        )
      );
      store.dispatch(selectTabContainer('lisbon'));
    },
  });

const windowMenuButton = () => {
  const block = document.querySelector<HTMLElement>(
    '[data-drop-window-id="w1"]'
  );
  if (!block) throw new Error('no window block');
  const own = within(block)
    .queryAllByRole('button', { name: 'More actions' })
    .filter((b) => !b.closest('[role="group"]'));
  expect(own).toHaveLength(1);
  return own[0];
};

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(windowMenuButton());
  return screen.getByRole('menu');
};

const names = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('aria-label') ?? i.textContent);

const MIXED = () => [
  tab('a1', 'a.test'),
  tab('b1', 'b.test'),
  tab('a2', 'a.test'),
  tab('b2', 'b.test'),
];

const storedIds = (state: RootState) =>
  state.tabContainerDataState.tabGroups[0].windows[0].tabs.map((t) => t.tabId);

describe('Sort tabs by site in a saved window menu (KAN-694)', () => {
  test('is the first item, above Remove duplicate tabs and Delete window', async () => {
    const user = userEvent.setup();
    await render([
      tab('a1', 'a.test'),
      tab('b1', 'b.test'),
      tab('a3', 'a.test', { url: 'https://a.test/a1' }),
    ]);
    const menu = await openMenu(user);
    expect(names(menu)).toEqual([
      expect.stringMatching(/Sort tabs by site$/),
      expect.stringMatching(/Remove 1 duplicate tab$/),
      expect.stringMatching(/Delete window$/),
    ]);
  });

  test('choosing it reorders the stored tabs and announces it with Undo', async () => {
    const user = userEvent.setup();
    const { store } = await render(MIXED());
    const menu = await openMenu(user);
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Sort tabs by site' })
    );
    expect(storedIds(store.getState())).toEqual(['a1', 'a2', 'b1', 'b2']);
    const toast = newestToast(store.getState());
    expect(toast?.text).toBe(TOAST_MESSAGES.TABS_SORTED_BY_SITE);
    expect(toast?.offersUndo).toBe(true);
  });

  test('is absent when the window is already sorted', async () => {
    const user = userEvent.setup();
    await render([
      tab('a1', 'a.test'),
      tab('a2', 'a.test'),
      tab('b1', 'b.test'),
    ]);
    const menu = await openMenu(user);
    expect(names(menu)).toEqual([expect.stringMatching(/Delete window$/)]);
  });
});
