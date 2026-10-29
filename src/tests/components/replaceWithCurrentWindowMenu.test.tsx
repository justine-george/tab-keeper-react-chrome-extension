import { afterEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { newestToast } from '../setup/toasts';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-866. A saved window's ⋮ and right-click menus offer Replace with current
// window after Rename, and only while the current window has a tab to capture.

afterEach(() => {
  fireEvent.keyDown(document.body, { key: 'Escape' });
});

const TK = 'chrome-extension://faketestid/index.html';
const tab = (tabId: string, host: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${host}/${tabId}`,
});

const current = (
  tabs: Partial<chrome.tabs.Tab>[],
  type: chrome.windows.Window['type'] = 'normal'
): ChromeSeed => ({
  windows: [{ id: 1, focused: true, type, tabs }],
});

const render = async (seed: ChromeSeed) => {
  const result = await renderWithProviders(<MainContainer />, {
    seed,
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({
            tabGroupId: 'lisbon',
            title: 'Lisbon trip',
            windowCount: 1,
            tabCount: 3,
            windows: [
              {
                windowId: 'w1',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 3,
                title: 'Planning',
                // a2 after b1: out of site order, so Sort is listed too.
                tabs: [
                  tab('a1', 'a.test'),
                  tab('b1', 'b.test'),
                  tab('a2', 'a.test'),
                ],
              },
            ],
          })
        )
      );
      store.dispatch(selectTabContainer('lisbon'));
    },
  });
  // The one question about the current window, answered.
  await act(async () => {});
  return result;
};

const windowBlock = () => {
  const block = document.querySelector<HTMLElement>(
    '[data-drop-window-id="w1"]'
  );
  if (!block) throw new Error('no window block');
  return block;
};
const windowMenuButton = () => {
  const own = within(windowBlock())
    .queryAllByRole('button', { name: 'More actions' })
    .filter((b) => !b.closest('[role="group"]'));
  expect(own).toHaveLength(1);
  return own[0];
};
const names = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('aria-label') ?? i.textContent);
const kebabNames = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(windowMenuButton());
  const list = names(screen.getByRole('menu'));
  await user.keyboard('{Escape}');
  return list;
};
// The right-click menu's list, below its top row.
const rightClickNames = () => {
  const row = windowBlock().querySelector<HTMLElement>(
    '[data-window-drag-handle]'
  );
  if (!row) throw new Error('no window row');
  fireEvent.contextMenu(row);
  const menu = document.querySelector<HTMLElement>('[data-row-menu]');
  if (!menu) throw new Error('no right-click menu');
  const top = menu.querySelector('[data-menu-action-row]');
  const list = within(menu)
    .getAllByRole('menuitem')
    .filter((i) => !top?.contains(i))
    .map((i) => i.getAttribute('aria-label') ?? i.textContent);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  return list;
};

const REPLACE = /Replace with current window$/;

describe('Replace with current window (KAN-866)', () => {
  test('the ⋮ lists it right after Rename window, before Sort', async () => {
    const user = userEvent.setup();
    await render(
      current([{ id: 11, url: 'https://live.test/', active: true }])
    );
    expect(await kebabNames(user)).toEqual([
      expect.stringMatching(/Copy all links$/),
      expect.stringMatching(/Rename window$/),
      expect.stringMatching(REPLACE),
      expect.stringMatching(/Sort tabs by site$/),
      expect.stringMatching(/Delete window$/),
    ]);
  });

  test('the right-click lists it first below the top row, after Copy all links', async () => {
    await render(
      current([{ id: 11, url: 'https://live.test/', active: true }])
    );
    expect(rightClickNames().slice(0, 2)).toEqual([
      expect.stringMatching(/Copy all links$/),
      expect.stringMatching(REPLACE),
    ]);
  });

  test('hidden when the current window holds only Tab Keeper', async () => {
    const user = userEvent.setup();
    await render(current([{ id: 11, url: TK, active: true }]));
    expect(await kebabNames(user)).not.toContainEqual(
      expect.stringMatching(REPLACE)
    );
    expect(rightClickNames()).not.toContainEqual(
      expect.stringMatching(REPLACE)
    );
  });

  test('hidden when only another window has tabs', async () => {
    const user = userEvent.setup();
    await render({
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: TK, active: true }] },
        { id: 2, tabs: [{ id: 21, url: 'https://elsewhere.test/' }] },
      ],
    });
    expect(await kebabNames(user)).not.toContainEqual(
      expect.stringMatching(REPLACE)
    );
  });

  test('hidden when the current window is not a normal one', async () => {
    const user = userEvent.setup();
    await render(current([{ id: 11, url: 'https://live.test/' }], 'popup'));
    expect(await kebabNames(user)).not.toContainEqual(
      expect.stringMatching(REPLACE)
    );
  });

  test('shows once the page is visible again and the window has gained a tab', async () => {
    const user = userEvent.setup();
    const { chrome } = await render(
      current([{ id: 11, url: TK, active: true }])
    );
    expect(await kebabNames(user)).not.toContainEqual(
      expect.stringMatching(REPLACE)
    );
    chrome.browser.openTab(1, { url: 'https://new.test/' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await kebabNames(user)).toContainEqual(
      expect.stringMatching(REPLACE)
    );
  });

  test('choosing it replaces the window and says so with Undo', async () => {
    const user = userEvent.setup();
    const { store } = await render(
      current([
        { id: 11, url: 'https://live.test/one', active: true },
        { id: 12, url: TK },
      ])
    );
    await user.click(windowMenuButton());
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Replace with current window',
      })
    );
    await act(async () => {});
    const w1 = store.getState().tabContainerDataState.tabGroups[0].windows[0];
    expect(w1.windowId).toBe('w1');
    expect(w1.title).toBe('Planning');
    expect(w1.tabs.map((t) => t.url)).toEqual(['https://live.test/one']);
    expect(w1.tabCount).toBe(1);
    const toast = newestToast(store.getState());
    expect(toast?.text).toBe(TOAST_MESSAGES.WINDOW_REPLACED);
    expect(toast?.offersUndo).toBe(true);
  });
});
