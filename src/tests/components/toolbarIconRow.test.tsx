import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { setToolbarIcon } from '../../redux/slices/settingsDataStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';
import { toolbarIconPath } from '../../utils/functions/toolbarIcon';

// KAN-932. Settings › Display › Toolbar icon. Saved first, then mirrored for the
// worker, then applied with setIcon. Each tile shows the icon beside Chrome's.

const renderDisplay = (
  seed: ChromeSeed = { action: {} },
  theme = Theme.CHALK
) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed,
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.DISPLAY));
      store.dispatch(setTheme(theme));
    },
  });

const group = () => screen.getByRole('group', { name: 'Toolbar icon' });
const tile = (name: 'Colour' | 'Light' | 'Dark') =>
  within(group()).getByRole('button', { name });
const savedSettings = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the Toolbar icon row', () => {
  test('sits under Themes, with Colour chosen on a new install', async () => {
    const { container } = await renderDisplay();
    const labels = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((section) => section.querySelector('span')?.textContent);
    expect(labels).toEqual(['Themes', 'Toolbar icon', 'Time format']);
    expect(tile('Colour')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('Light')).toHaveAttribute('aria-pressed', 'false');
    expect(tile('Dark')).toHaveAttribute('aria-pressed', 'false');
  });

  test('says what it changes, as the description of every tile', async () => {
    await renderDisplay();
    for (const name of ['Colour', 'Light', 'Dark'] as const) {
      expect(tile(name)).toHaveAccessibleDescription(/Chrome’s toolbar/);
    }
  });

  test('a tile saves, mirrors for the worker, then applies', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderDisplay();

    await user.click(tile('Dark'));

    await waitFor(() =>
      expect(chrome.iconsSet).toEqual([toolbarIconPath('dark')])
    );
    expect(savedSettings()).toMatchObject({ toolbarIcon: 'dark' });
    expect(chrome.localArea()).toMatchObject({ toolbarIcon: 'dark' });
    expect(tile('Dark')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('Colour')).toHaveAttribute('aria-pressed', 'false');
  });

  test('back to Colour restores the default icon', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderDisplay();

    await user.click(tile('Light'));
    await user.click(tile('Colour'));

    await waitFor(() =>
      expect(chrome.iconsSet).toEqual([
        toolbarIconPath('light'),
        'icons/icon128.png',
      ])
    );
  });

  test('worst path: a refused setIcon keeps the choice, so the next start applies it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const { chrome } = await renderDisplay({
      action: { setIconRejects: true },
    });

    await user.click(tile('Light'));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(savedSettings()).toMatchObject({ toolbarIcon: 'light' });
    expect(chrome.localArea()).toMatchObject({ toolbarIcon: 'light' });
    expect(tile('Light')).toHaveAttribute('aria-pressed', 'true');
  });

  test('shows the choice another page made', async () => {
    const { store } = await renderDisplay();
    store.dispatch(setToolbarIcon('light'));
    await waitFor(() =>
      expect(tile('Light')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  test.each([
    ['Colour', Theme.CHALK, '#f1f3f4'],
    ['Colour', Theme.CHARCOAL, '#3c3c3c'],
    ['Light', Theme.CHALK, '#3c3c3c'],
    ['Dark', Theme.CHARCOAL, '#f1f3f4'],
  ] as const)('%s in %s sits on a %s toolbar', async (name, theme, toolbar) => {
    await renderDisplay({ action: {} }, theme);
    const swatch = tile(name).querySelector('[data-swatch-tile]');
    expect(swatch).toHaveStyle({ backgroundColor: toolbar });
  });

  test('each tile shows the icon left of the puzzle piece and the ⋮, as Chrome does', async () => {
    await renderDisplay();
    const parts = [
      ...(tile('Dark').querySelector('[data-swatch-tile]')?.children ?? []),
    ].map((part) => part.getAttribute('data-toolbar-part'));
    expect(parts).toEqual(['icon', 'puzzle', 'menu']);
    expect(tile('Dark').querySelector('img')).toHaveAttribute(
      'src',
      'icons/toolbar-dark-16.png'
    );
  });
});
