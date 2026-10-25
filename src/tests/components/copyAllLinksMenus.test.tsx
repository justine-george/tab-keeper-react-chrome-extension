import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import {
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-783. Copy all links on a window's and a group's menu, live and saved,
// FIRST (pick 1A); and in Open now's header right-click after the two saves.
// Each copy is headed by what was copied (pick 2B).

// jsdom has no ClipboardItem, so every copy lands as the plain list.
const clipboard = (writeText: (text: string) => Promise<void>) => {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: spy },
    configurable: true,
  });
  return spy;
};
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});
beforeEach(() => localStorage.clear());

const refused = () => Promise.reject(new DOMException('no', 'NotAllowedError'));

const menuKeys = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('data-menu-item'));

const chooseCopy = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(
    within(screen.getByRole('menu')).getByRole('menuitem', {
      name: 'Copy all links',
    })
  );

describe('live windows and groups (Open now)', () => {
  const tab = (
    id: number,
    extra: Partial<{ groupId: number; active: boolean }> = {}
  ) => ({ id, title: `t${id}`, url: `https://h${id}.test/`, ...extra });

  // This window holds one tab, so it has nothing to sort. Window 2: a loose
  // tab, then Docs (22, 23), then an unnamed group (24).
  const seed: ChromeSeed = {
    grantedPermissions: ['tabGroups'],
    currentTabId: 11,
    windows: [
      { id: 1, focused: true, tabs: [tab(11, { active: true })] },
      {
        id: 2,
        tabs: [
          tab(21, { active: true }),
          tab(22, { groupId: 50 }),
          tab(23, { groupId: 50 }),
          tab(24, { groupId: 51 }),
        ],
      },
    ],
    tabGroups: [
      { id: 50, windowId: 2, title: 'Docs', color: 'blue' },
      { id: 51, windowId: 2, title: '', color: 'red' },
    ],
  };

  async function renderOpenNow() {
    const result = await renderWithProviders(
      <>
        <OpenNowColumn folded={true} />
        <Toast />
      </>,
      {
        seed,
        seedStore: (store) => {
          store.dispatch(setHasTabGroupsPermission(true));
        },
      }
    );
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
    return result;
  }

  const block = (windowId: number) => {
    const el = document.querySelector<HTMLElement>(
      `[data-open-window-id="${windowId}"]`
    );
    if (!el) throw new Error('no window block');
    return el;
  };
  const openWindowMenu = (
    user: ReturnType<typeof userEvent.setup>,
    windowId: number
  ) =>
    user.click(
      within(block(windowId)).getByRole('button', {
        name: `More actions: Window ${windowId}`,
      })
    );

  test("a window's ⋮ leads with Copy all links, and it copies that window headed by its number", async () => {
    const user = userEvent.setup();
    const writeText = clipboard(() => Promise.resolve());
    await renderOpenNow();

    await openWindowMenu(user, 2);
    expect(menuKeys()[0]).toBe('copy');
    await chooseCopy(user);

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      [
        'Window 2',
        '4 Tabs',
        '',
        '- t21',
        '  https://h21.test/',
        '',
        'Docs (2 Tabs)',
        '  - t22',
        '    https://h22.test/',
        '  - t23',
        '    https://h23.test/',
        '',
        '1 Tab',
        '  - t24',
        '    https://h24.test/',
      ].join('\n')
    );
    expect(await screen.findByText('4 links copied.')).toBeVisible();
  });

  test("the window row's right-click offers the same first item", async () => {
    await renderOpenNow();

    fireEvent.contextMenu(within(block(2)).getByText('Window 2'));

    expect(menuKeys()[0]).toBe('copy');
  });

  test('This window always has a ⋮: with nothing to sort it holds Copy all links alone', async () => {
    const user = userEvent.setup();
    const writeText = clipboard(() => Promise.resolve());
    await renderOpenNow();

    await openWindowMenu(user, 1);
    expect(menuKeys()).toEqual(['copy']);
    await chooseCopy(user);

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      ['Window 1', '1 Tab', '', '- t11', '  https://h11.test/'].join('\n')
    );
  });

  test("a group's ⋮ leads with Copy all links, and it copies only that group's tabs under its name", async () => {
    const user = userEvent.setup();
    const writeText = clipboard(() => Promise.resolve());
    await renderOpenNow();

    await user.click(
      screen.getByRole('button', { name: 'More actions: Docs' })
    );
    expect(menuKeys()[0]).toBe('copy');
    await chooseCopy(user);

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      [
        'Docs',
        '2 Tabs',
        '',
        '- t22',
        '  https://h22.test/',
        '- t23',
        '  https://h23.test/',
      ].join('\n')
    );
    expect(await screen.findByText('2 links copied.')).toBeVisible();
  });

  test('an unnamed group is headed "Unnamed group"', async () => {
    const user = userEvent.setup();
    const writeText = clipboard(() => Promise.resolve());
    await renderOpenNow();

    await user.click(
      screen.getByRole('button', { name: 'More actions: Unnamed group' })
    );
    await chooseCopy(user);

    // Its own tab, not Docs's: the band pressed is the one copied.
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      ['Unnamed group', '1 Tab', '', '- t24', '  https://h24.test/'].join('\n')
    );
  });

  // KAN-713's worst path: nothing reached the clipboard, so nothing is announced.
  test('a refused clipboard copies nothing and shows no toast', async () => {
    const user = userEvent.setup();
    const writeText = clipboard(refused);
    const { store } = await renderOpenNow();

    await openWindowMenu(user, 2);
    await chooseCopy(user);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(newestToast(store.getState())).toBeUndefined();
  });

  describe("Open now's header right-click", () => {
    const header = () => {
      const el = document.querySelector<HTMLElement>('[data-open-now-header]');
      if (!el) throw new Error('no Open now header');
      return el;
    };
    const openHeaderMenu = () =>
      fireEvent.contextMenu(
        within(header()).getByRole('heading', { name: 'Open now' })
      );

    test('Copy all links sits after the two saves and before Save as PDF', async () => {
      await renderOpenNow();

      openHeaderMenu();

      expect(menuKeys()).toEqual([
        'save-all-windows',
        'save-current-window',
        'copy',
        'export-open-windows',
      ]);
    });

    test("it copies every open window in the session copy's shape, named as Save all would name it", async () => {
      const user = userEvent.setup();
      const writeText = clipboard(() => Promise.resolve());
      await renderOpenNow();

      openHeaderMenu();
      await chooseCopy(user);

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const lines = String(writeText.mock.calls[0][0]).split('\n');
      // Save all names the session from This window's tab.
      expect(lines.slice(0, 4)).toEqual([
        't11',
        '2 Windows · 5 Tabs',
        '',
        'WINDOW 1 (1 Tab)',
      ]);
      expect(lines).toContain('WINDOW 2 (4 Tabs)');
      expect(await screen.findByText('5 links copied.')).toBeVisible();
    });

    // O14e: a held search hides tabs, and the copy would carry them unseen.
    test('is left out while the Open now search holds text, and the saves stay', async () => {
      const user = userEvent.setup();
      await renderOpenNow();
      await user.type(
        screen.getByRole('textbox', { name: 'Search open tabs' }),
        't2'
      );

      openHeaderMenu();

      expect(menuKeys()).toEqual([
        'save-all-windows',
        'save-current-window',
        'export-open-windows',
      ]);
    });
  });
});

describe('saved windows and groups', () => {
  const tab = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
    tabId,
    favicon: '',
    title: tabId,
    url: `https://${tabId}.test/`,
    ...extra,
  });

  // Planning: a loose tab, then Research (r1, r2), then another loose tab.
  const render = ({ windowTitle = 'Planning', groupTitle = 'Research' } = {}) =>
    renderWithProviders(<MainContainer />, {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(
          saveToTabContainerInternal(
            buildSession({
              tabGroupId: 'lisbon',
              title: 'Lisbon trip',
              windowCount: 1,
              tabCount: 4,
              windows: [
                {
                  windowId: 'w1',
                  windowHeight: 100,
                  windowWidth: 100,
                  windowOffsetTop: 0,
                  windowOffsetLeft: 0,
                  tabCount: 4,
                  title: windowTitle,
                  chromeTabGroups: [
                    { groupId: 'g1', title: groupTitle, color: 'blue' },
                  ],
                  tabs: [
                    tab('a'),
                    tab('r1', { chromeGroupId: 'g1' }),
                    tab('r2', { chromeGroupId: 'g1' }),
                    tab('z'),
                  ],
                },
              ],
            })
          )
        );
        store.dispatch(selectTabContainer('lisbon'));
      },
    });

  const windowBlock = () => {
    const el = document.querySelector<HTMLElement>(
      '[data-drop-window-id="w1"]'
    );
    if (!el) throw new Error('no window block');
    return el;
  };
  // The window's own ⋮, not a group band's.
  const windowMenuButton = () =>
    within(windowBlock())
      .getAllByRole('button', { name: 'More actions' })
      .filter((b) => !b.closest('[role="group"]'))[0];
  const groupMenuButton = (name: RegExp = /Research/) =>
    within(screen.getByRole('group', { name })).getAllByRole('button', {
      name: 'More actions',
    })[0];

  test("a saved window's ⋮ leads with Copy all links, and it copies that window under its name", async () => {
    const user = userEvent.setup();
    const writeText = clipboard(() => Promise.resolve());
    const { store } = await render();

    await user.click(windowMenuButton());
    expect(menuKeys()[0]).toBe('copy');
    await chooseCopy(user);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      [
        'Planning',
        '4 Tabs',
        '',
        '- a',
        '  https://a.test/',
        '',
        'Research (2 Tabs)',
        '  - r1',
        '    https://r1.test/',
        '  - r2',
        '    https://r2.test/',
        '',
        '- z',
        '  https://z.test/',
      ].join('\n')
    );
    const toast = newestToast(store.getState());
    expect(toast?.text).toBe(TOAST_MESSAGES.COPY_LINKS_SUCCESS);
    expect(toast?.params).toEqual({ count: 4 });
  });

  test("a saved group's ⋮ leads with Copy all links, and it copies only the group's tabs", async () => {
    const user = userEvent.setup();
    const writeText = clipboard(() => Promise.resolve());
    const { store } = await render();

    await user.click(groupMenuButton());
    expect(menuKeys()[0]).toBe('copy');
    await chooseCopy(user);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      [
        'Research',
        '2 Tabs',
        '',
        '- r1',
        '  https://r1.test/',
        '- r2',
        '  https://r2.test/',
      ].join('\n')
    );
    expect(newestToast(store.getState())?.params).toEqual({ count: 2 });
  });

  // As drawn: an unnamed window reads its number, an unnamed group "Unnamed group".
  test('an unnamed saved window and group are headed as their rows read', async () => {
    const user = userEvent.setup();
    const writeText = clipboard(() => Promise.resolve());
    await render({ windowTitle: '', groupTitle: '' });

    await user.click(windowMenuButton());
    await chooseCopy(user);
    await user.click(groupMenuButton(/Unnamed group/));
    await chooseCopy(user);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(
      writeText.mock.calls.map(([text]) => text.split('\n').slice(0, 2))
    ).toEqual([
      ['Window 1', '4 Tabs'],
      ['Unnamed group', '2 Tabs'],
    ]);
  });

  test('a refused clipboard shows no toast from a saved window either', async () => {
    const user = userEvent.setup();
    const writeText = clipboard(refused);
    const { store } = await render();

    await user.click(windowMenuButton());
    await chooseCopy(user);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(newestToast(store.getState())).toBeUndefined();
  });

  // CONTROL for the saved search: the same menus are gone while it holds text.
  test('under a saved search the window and group give no menu', async () => {
    const { store } = await render();
    expect(windowMenuButton()).toBeTruthy();

    store.dispatch(setSearchInputText('r1'));

    await waitFor(() =>
      expect(
        within(windowBlock()).queryAllByRole('button', { name: 'More actions' })
      ).toEqual([])
    );
  });
});
