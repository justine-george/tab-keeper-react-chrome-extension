import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { newestToast } from '../setup/toasts';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { RootState } from '../../redux/store';
import type { chromeTabGroupData } from '../../utils/functions/tabGroups';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-746 Part 2. A window's ⋮ and right-click offer Sort groups by name right
// under Sort tabs by site, saved and in Open now, only while two or more groups
// are out of name order.

const labelOf = (item: HTMLElement) => {
  // The glyph's ligature text is aria-hidden; the label is what is left.
  const copy = item.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden]').forEach((n) => n.remove());
  return copy.textContent;
};
const labels = (menu: HTMLElement) =>
  within(menu).getAllByRole('menuitem').map(labelOf);

describe('saved window', () => {
  // All one site, so Sort tabs by site only moves loose tabs after the groups.
  const tab = (tabId: string, chromeGroupId?: string): tabData => ({
    tabId,
    favicon: '',
    title: tabId,
    url: `https://a.test/${tabId}`,
    ...(chromeGroupId ? { chromeGroupId } : {}),
  });
  const ZULU: chromeTabGroupData = {
    groupId: 'gZ',
    title: 'Zulu',
    color: 'blue',
  };
  const ALPHA: chromeTabGroupData = {
    groupId: 'gA',
    title: 'alpha',
    color: 'red',
  };

  const render = (
    tabs: tabData[],
    groups: chromeTabGroupData[],
    { granted = true }: { granted?: boolean } = {}
  ) =>
    renderWithProviders(<MainContainer />, {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(granted));
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
                  chromeTabGroups: groups,
                  tabs,
                },
              ],
            })
          )
        );
        store.dispatch(selectTabContainer('lisbon'));
      },
    });

  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    const block = document.querySelector<HTMLElement>(
      '[data-drop-window-id="w1"]'
    );
    if (!block) throw new Error('no window block');
    const own = within(block)
      .queryAllByRole('button', { name: 'More actions' })
      .filter((b) => !b.closest('[role="group"]'));
    expect(own).toHaveLength(1);
    await user.click(own[0]);
    return screen.getByRole('menu');
  };
  const storedIds = (state: RootState) =>
    state.tabContainerDataState.tabGroups[0].windows[0].tabs.map(
      (t) => t.tabId
    );

  // KAN-793. The right-click adds the row's Open · Add tab · Rename on top.
  test('sits right under Sort tabs by site, and the right-click offers the same under its top row', async () => {
    const user = userEvent.setup();
    await render([tab('x'), tab('z1', 'gZ'), tab('a1', 'gA')], [ZULU, ALPHA]);
    const dots = labels(await openMenu(user));
    expect(dots).toEqual([
      'Copy all links',
      'Rename window',
      'Sort tabs by site',
      'Sort groups by name',
      'Delete window',
    ]);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename window: Planning' })
    );
    expect(labels(screen.getByRole('menu'))).toEqual([
      'Open',
      'Add tab',
      'Rename',
      ...dots.filter((label) => label !== 'Rename window'),
    ]);
  });

  // KAN-804. Two sorts, two glyphs: by name draws the sessions list's Name glyph.
  test('draws sort_by_alpha, and Sort tabs by site keeps sort', async () => {
    const user = userEvent.setup();
    await render([tab('x'), tab('z1', 'gZ'), tab('a1', 'gA')], [ZULU, ALPHA]);
    const menu = await openMenu(user);
    const glyph = (name: string) =>
      within(menu)
        .getByRole('menuitem', { name })
        .querySelector('[data-icon]')
        ?.getAttribute('data-icon');
    expect(glyph('Sort groups by name')).toBe('sort_by_alpha');
    expect(glyph('Sort tabs by site')).toBe('sort');
  });

  test('choosing it moves only the groups and says so with Undo', async () => {
    const user = userEvent.setup();
    const { store } = await render(
      [tab('x'), tab('z1', 'gZ'), tab('z2', 'gZ'), tab('y'), tab('a1', 'gA')],
      [ZULU, ALPHA]
    );
    const menu = await openMenu(user);
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Sort groups by name' })
    );
    expect(storedIds(store.getState())).toEqual(['x', 'a1', 'y', 'z1', 'z2']);
    const toast = newestToast(store.getState());
    expect(toast?.text).toBe(TOAST_MESSAGES.GROUPS_SORTED_BY_NAME);
    expect(toast?.offersUndo).toBe(true);
  });

  test('is absent when the groups are in name order, unnamed last', async () => {
    const user = userEvent.setup();
    await render(
      [tab('a1', 'gA'), tab('z1', 'gZ'), tab('u1', 'gU'), tab('x')],
      [ALPHA, ZULU, { groupId: 'gU', title: '', color: 'grey' }]
    );
    expect(labels(await openMenu(user))).toEqual([
      'Copy all links',
      'Rename window',
      'Delete window',
    ]);
  });

  // Without the grant the window draws flat, so there are no groups on screen to sort.
  test('is absent without the tab group grant', async () => {
    const user = userEvent.setup();
    await render([tab('z1', 'gZ'), tab('a1', 'gA')], [ZULU, ALPHA], {
      granted: false,
    });
    expect(labels(await openMenu(user))).not.toContain('Sort groups by name');
  });

  test('is absent with only one group', async () => {
    const user = userEvent.setup();
    await render([tab('z1', 'gZ'), tab('x')], [ZULU]);
    expect(labels(await openMenu(user))).toEqual([
      'Copy all links',
      'Rename window',
      'Delete window',
    ]);
  });
});

describe('Open now window', () => {
  const url = (path: string) => `https://a.test/${path}`;
  const tab = (
    id: number,
    groupId = -1,
    extra: Partial<{ splitViewId: number; active: boolean }> = {}
  ) => ({ id, title: `t${id}`, url: url(String(id)), groupId, ...extra });

  // W2: loose 21, "Zulu" (22, 23), loose 24, "alpha" (25).
  const seed = (
    w2: ReturnType<typeof tab>[],
    groups: { id: number; title: string }[]
  ): ChromeSeed => ({
    grantedPermissions: ['tabGroups'],
    windows: [
      { id: 1, focused: true, tabs: [tab(11, -1, { active: true })] },
      { id: 2, tabs: w2 },
    ],
    tabGroups: groups.map((g) => ({ ...g, windowId: 2, color: 'blue' })),
  });
  const OUT_OF_ORDER = () => [
    tab(21, -1, { active: true }),
    tab(22, 200),
    tab(23, 200),
    tab(24),
    tab(25, 100),
  ];
  const GROUPS = [
    { id: 200, title: 'Zulu' },
    { id: 100, title: 'alpha' },
  ];

  async function renderOpenNow(chromeSeed: ChromeSeed) {
    const result = await renderWithProviders(
      <>
        <OpenNowColumn folded={true} />
        <Toast />
      </>,
      {
        seed: chromeSeed,
        seedStore: (store) => {
          store.dispatch(setHasTabGroupsPermission(true));
        },
      }
    );
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
    return result;
  }
  const blockOf = (windowId: number) => {
    const block = document.querySelector(`[data-open-window-id="${windowId}"]`);
    if (!(block instanceof HTMLElement)) throw new Error('no window block');
    return block;
  };
  const openMenu = async (
    user: ReturnType<typeof userEvent.setup>,
    windowId: number
  ) => {
    await user.click(
      within(blockOf(windowId)).getAllByRole('button', {
        name: `More actions: Window ${windowId}`,
      })[0]
    );
    return screen.getByRole('menu');
  };
  const menuKeys = () =>
    within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((i) => i.getAttribute('data-menu-item'));
  const idsIn = async (windowId: number) =>
    (await chrome.tabs.query({ windowId }))
      .sort((x, y) => x.index - y.index)
      .map((t) => t.id);

  test('sits right under Sort tabs by site, above Close window', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(OUT_OF_ORDER(), GROUPS));
    await openMenu(user, 2);
    expect(menuKeys()).toEqual([
      'copy',
      'sortBySite',
      'sortGroupsByName',
      'closeWindow',
    ]);
  });

  // KAN-804. As in a saved window.
  test('draws sort_by_alpha, and Sort tabs by site keeps sort', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(OUT_OF_ORDER(), GROUPS));
    const menu = await openMenu(user, 2);
    const glyph = (name: string) =>
      within(menu)
        .getByRole('menuitem', { name })
        .querySelector('[data-icon]')
        ?.getAttribute('data-icon');
    expect(glyph('Sort groups by name')).toBe('sort_by_alpha');
    expect(glyph('Sort tabs by site')).toBe('sort');
  });

  test('choosing it moves only the groups in Chrome, never a loose tab, and says so', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(OUT_OF_ORDER(), GROUPS));
    const tabMoves = vi.spyOn(chrome.tabs, 'move');
    const menu = await openMenu(user, 2);
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Sort groups by name' })
    );
    await waitFor(async () =>
      expect(await idsIn(2)).toEqual([21, 25, 24, 22, 23])
    );
    expect(tabMoves).not.toHaveBeenCalled();
    expect(await screen.findByText('Sorted the groups by name.')).toBeVisible();
  });

  test('is offered in a window with a split view, which a group move keeps', async () => {
    const user = userEvent.setup();
    await renderOpenNow(
      seed(
        [
          tab(21, -1, { active: true }),
          tab(22, 200, { splitViewId: 7 }),
          tab(23, 200, { splitViewId: 7 }),
          tab(25, 100),
        ],
        GROUPS
      )
    );
    await openMenu(user, 2);
    expect(menuKeys()).toContain('sortGroupsByName');
  });

  test('is absent when the groups are in name order', async () => {
    const user = userEvent.setup();
    await renderOpenNow(
      seed(
        [tab(21, -1, { active: true }), tab(25, 100), tab(22, 200), tab(24)],
        GROUPS
      )
    );
    await openMenu(user, 2);
    expect(menuKeys()).not.toContain('sortGroupsByName');
  });
});
