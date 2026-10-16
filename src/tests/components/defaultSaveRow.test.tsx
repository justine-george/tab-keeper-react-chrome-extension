import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { setDefaultSaveScope } from '../../redux/slices/settingsDataStateSlice';
import type { CaptureScope } from '../../utils/functions/capture';

// KAN-635. The save button and Enter take the Default save setting; the other scope is the menu's first item.
// The fake answers windows.getCurrent with the first seeded window, so Kagi's is the current one.
const twoWindows = {
  tabs: [
    { id: 1, title: 'Kagi Search', url: 'https://kagi.com/', active: true },
  ],
  windows: [
    {
      id: 7,
      tabs: [
        { id: 1, title: 'Kagi Search', url: 'https://kagi.com/' },
      ] as chrome.tabs.Tab[],
    },
    {
      id: 8,
      tabs: [
        { id: 2, title: 'Example', url: 'https://example.com/' },
      ] as chrome.tabs.Tab[],
    },
  ],
};

const ALL = 'Save all open windows as a session';
const CURRENT = 'Save current window as a session';

afterEach(() => localStorage.clear());

async function renderRow(scope: CaptureScope) {
  const result = await renderWithProviders(<UserInputContainer />, {
    seed: twoWindows,
    seedStore: (store) => store.dispatch(setDefaultSaveScope(scope)),
  });
  await act(async () => {});
  return result;
}

const glyphOf = (el: HTMLElement) =>
  el.querySelector('.material-symbols-outlined')?.textContent;

const openSaveMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
};

const savedWindowCount = (
  store: Awaited<ReturnType<typeof renderRow>>['store']
) => store.getState().tabContainerDataState.tabGroups[0]?.windows.length;

describe.each([
  ['all-windows', ALL, 'library_add', CURRENT, 'add_box', 2, 1],
  ['current-window', CURRENT, 'add_box', ALL, 'library_add', 1, 2],
] as const)(
  'Default save %s',
  (
    scope,
    buttonName,
    buttonGlyph,
    itemName,
    itemGlyph,
    buttonWindows,
    itemWindows
  ) => {
    test('the button is that save, by name, tooltip and glyph; the other is not a button', async () => {
      await renderRow(scope);
      const button = screen.getByRole('button', { name: buttonName });
      expect(button).toHaveAttribute('title', buttonName);
      expect(glyphOf(button)).toBe(buttonGlyph);
      expect(screen.queryByRole('button', { name: itemName })).toBeNull();
    });

    test('the button saves that scope', async () => {
      const { store } = await renderRow(scope);
      await userEvent.click(screen.getByRole('button', { name: buttonName }));
      expect(savedWindowCount(store)).toBe(buttonWindows);
    });

    test('Enter saves the same scope as the button', async () => {
      const { store } = await renderRow(scope);
      await userEvent.type(screen.getByRole('textbox'), '{Enter}');
      expect(savedWindowCount(store)).toBe(buttonWindows);
    });

    test('the menu holds the other save first, then Export', async () => {
      const { store } = await renderRow(scope);
      const items = within(await openSaveMenu()).getAllByRole('menuitem');
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveAccessibleName(itemName);
      expect(glyphOf(items[0])).toBe(itemGlyph);
      expect(items[1]).toHaveAccessibleName('Export open windows…');
      await userEvent.click(items[0]);
      expect(savedWindowCount(store)).toBe(itemWindows);
    });
  }
);

describe('Default save current window', () => {
  test('the button’s save says it saved the current window', async () => {
    const { store } = await renderRow('current-window');
    await userEvent.click(screen.getByRole('button', { name: CURRENT }));
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS
    );
  });

  test('the menu’s save says it saved every window', async () => {
    const { store } = await renderRow('current-window');
    const menu = await openSaveMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: ALL }));
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.SAVE_ALL_WINDOWS_SUCCESS
    );
  });

  // Settings is another page in the full view; a change there reaches a row already drawn.
  test('a change while the row is drawn swaps it without a remount', async () => {
    const { store } = await renderRow('all-windows');
    const field = screen.getByRole('textbox');
    act(() => {
      store.dispatch(setDefaultSaveScope('current-window'));
    });
    expect(screen.getByRole('button', { name: CURRENT })).toBeTruthy();
    expect(screen.getByRole('textbox')).toBe(field);
  });
});
