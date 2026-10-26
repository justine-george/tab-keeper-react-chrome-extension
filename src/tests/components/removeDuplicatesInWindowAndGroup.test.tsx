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
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-616 (picks 1A, 2A). Every window row has a ⋮ where Delete was, holding
// Remove duplicate tabs while the window repeats an address, then Delete. A
// group's ⋮ offers it between Ungroup and Delete group.

const tab = (tabId: string, url: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});
const A = 'https://a.test/';
const G = 'https://guide.test/';
const T = 'https://tram.test/';

// Planning: a, the Research group (guide, tram, guide again), then a again.
// Reading: a third a, which repeats Planning's but nothing in Reading.
const render = () =>
  renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({
            tabGroupId: 'lisbon',
            title: 'Lisbon trip',
            windowCount: 2,
            tabCount: 6,
            windows: [
              {
                windowId: 'w1',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 5,
                title: 'Planning',
                chromeTabGroups: [
                  { groupId: 'g1', title: 'Research', color: 'blue' },
                ],
                tabs: [
                  tab('a', A),
                  tab('guide', G, 'g1'),
                  tab('tram', T, 'g1'),
                  tab('guide2', G, 'g1'),
                  tab('a2', A),
                ],
              },
              {
                windowId: 'w2',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 1,
                title: 'Reading',
                tabs: [tab('a3', A)],
              },
            ],
          })
        )
      );
      store.dispatch(selectTabContainer('lisbon'));
    },
  });

const block = (windowId: string) =>
  document.querySelector<HTMLElement>(`[data-drop-window-id="${windowId}"]`)!;

// The window's own ⋮: the one in its block that no group band holds.
const windowMenuButton = (windowId: string) => {
  const own = within(block(windowId))
    .queryAllByRole('button', { name: 'More actions' })
    .filter((b) => !b.closest('[role="group"]'));
  expect(own).toHaveLength(1);
  return own[0];
};

const openWindowMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  windowId: string
) => {
  await user.click(windowMenuButton(windowId));
  return screen.getByRole('menu');
};

const openGroupMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  const band = screen.getByRole('group', { name: /Research/ });
  await user.click(within(band).getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
};

const items = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.textContent?.replace(/^[a-z_]+/, ''));

const tabsOf = (
  store: Awaited<ReturnType<typeof render>>['store'],
  windowId: string
) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows.find(
      (w) => w.windowId === windowId
    )!
    .tabs.map((t) => t.tabId);

describe('the window ⋮ (KAN-616, 1A)', () => {
  test('replaces the Delete icon on the row', async () => {
    await render();
    expect(
      within(block('w1')).queryByRole('button', { name: 'Delete window' })
    ).toBeNull();
    windowMenuButton('w1');
  });

  test('offers Remove duplicate tabs, with the count, before Delete', async () => {
    const user = userEvent.setup();
    await render();
    const menu = await openWindowMenu(user, 'w1');
    // Copy all links (KAN-783) first; Planning is out of order, so Sort tabs by site (KAN-694) follows.
    expect(items(menu)).toEqual([
      'Copy all links',
      'Rename window',
      'Sort tabs by site',
      'Remove 2 duplicate tabs',
      'Delete window',
    ]);
  });

  test('a window whose copies all live elsewhere offers no Remove', async () => {
    const user = userEvent.setup();
    await render();
    const menu = await openWindowMenu(user, 'w2');
    expect(items(menu)).toEqual([
      'Copy all links',
      'Rename window',
      'Delete window',
    ]);
  });

  test('Remove takes out the window’s repeats only, with Undo', async () => {
    const user = userEvent.setup();
    const { store } = await render();
    const menu = await openWindowMenu(user, 'w1');
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Remove 2 duplicate tabs' })
    );
    expect(tabsOf(store, 'w1')).toEqual(['a', 'guide', 'tram']);
    expect(tabsOf(store, 'w2')).toEqual(['a3']);
    expect(newestToast(store.getState())).toMatchObject({
      text: TOAST_MESSAGES.DUPLICATE_TABS_REMOVED,
      params: { count: 2 },
      offersUndo: true,
    });
  });

  test('Delete window deletes the window', async () => {
    const user = userEvent.setup();
    const { store } = await render();
    const menu = await openWindowMenu(user, 'w2');
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Delete window' })
    );
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups[0].windows.map((w) => w.windowId)
    ).toEqual(['w1']);
  });
});

describe('the group ⋮ (KAN-616, 2A)', () => {
  test('offers Remove between Ungroup and Delete tab group', async () => {
    const user = userEvent.setup();
    await render();
    const menu = await openGroupMenu(user);
    // KAN-746: guide, tram, guide is out of site order, so Sort follows Copy all links and Rename (KAN-805).
    expect(items(menu)).toEqual([
      'Copy all links',
      'Rename group',
      'Sort tabs by site',
      'Ungroup',
      'Remove 1 duplicate tab',
      'Delete tab group',
    ]);
  });

  test('Remove takes out the group’s repeat and leaves the copy outside it', async () => {
    const user = userEvent.setup();
    const { store } = await render();
    const menu = await openGroupMenu(user);
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Remove 1 duplicate tab' })
    );
    expect(tabsOf(store, 'w1')).toEqual(['a', 'guide', 'tram', 'a2']);
    expect(newestToast(store.getState())).toMatchObject({
      params: { count: 1 },
    });
  });
});

// The window's action strip is a stacking context (translateY), so its menu
// painted BEHIND the tab rows below it until the strip itself was lifted. jsdom
// cannot paint; e2e/window-menu-paints-on-top.spec.ts checks what is drawn.
describe('the window strip lifts while its menu is open (KAN-616)', () => {
  const strip = (windowId: string) =>
    windowMenuButton(windowId).closest<HTMLElement>('[data-row-actions]')!;

  test('opening the menu raises the strip', async () => {
    const user = userEvent.setup();
    await render();
    await user.click(windowMenuButton('w1'));
    expect(getComputedStyle(strip('w1')).zIndex).toBe('3');
  });

  // THE CONTROL: a strip lifted for good would win over the next window's
  // open menu, so a closed one must not be.
  test('a closed menu leaves it where it was', async () => {
    const user = userEvent.setup();
    await render();
    await user.click(windowMenuButton('w2'));
    expect(getComputedStyle(strip('w1')).zIndex).not.toBe('3');
  });
});
