import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { useToolbarIconMode } from '../../hooks/useToolbarIconMode';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  setTheme,
  setToolbarIcon,
  Theme,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-932, KAN-933. Settings › Display › Toolbar icon: Colour or Monochrome. A page
// reads Chrome's mode, because the worker has no way to, and mirrors it for the
// worker's next start.

const LIGHT_ICON = {
  16: 'icons/toolbar-light-16.png',
  32: 'icons/toolbar-light-32.png',
};
const DARK_ICON = {
  16: 'icons/toolbar-dark-16.png',
  32: 'icons/toolbar-dark-32.png',
};
const COLOUR = 'icons/icon128.png';

const original = window.matchMedia;
const chromeMode = (dark: boolean) => {
  const list = new FakeMediaQueryList('(prefers-color-scheme: dark)', dark);
  window.matchMedia = ((query: string) =>
    query === list.media
      ? list
      : new FakeMediaQueryList(query, false)) as typeof window.matchMedia;
  return list;
};

// Settings, with the hook App runs on every page.
function Page() {
  useToolbarIconMode();
  return <SettingsDetailsContainer />;
}

const renderDisplay = (
  seed: ChromeSeed = { action: {} },
  theme = Theme.CHALK
) =>
  renderWithProviders(<Page />, {
    seed,
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.DISPLAY));
      store.dispatch(setTheme(theme));
    },
  });

const group = () => screen.getByRole('group', { name: 'Toolbar icon' });
const tile = (name: 'Color' | 'Monochrome') =>
  within(group()).getByRole('button', { name });
const savedSettings = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => {
  window.matchMedia = original;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the Toolbar icon row', () => {
  test('sits under Themes, with Colour chosen on a new install and only two tiles', async () => {
    const { container } = await renderDisplay();
    const labels = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((section) => section.querySelector('span')?.textContent);
    expect(labels).toEqual(['Themes', 'Toolbar icon', 'Time format']);
    expect(within(group()).getAllByRole('button')).toHaveLength(2);
    expect(tile('Color')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('Monochrome')).toHaveAttribute('aria-pressed', 'false');
  });

  test('says what it changes, as the description of every tile', async () => {
    await renderDisplay();
    for (const name of ['Color', 'Monochrome'] as const) {
      expect(tile(name)).toHaveAccessibleDescription(/Chrome’s toolbar/);
    }
  });

  test('on a new install, nothing touches the toolbar', async () => {
    const { chrome } = await renderDisplay();
    expect(chrome.iconsSet).toEqual([]);
  });

  test('choosing Monochrome saves it, mirrors it and the mode, then applies', async () => {
    chromeMode(true);
    const user = userEvent.setup();
    const { chrome } = await renderDisplay();

    await user.click(tile('Monochrome'));

    await waitFor(() => expect(chrome.iconsSet).toEqual([LIGHT_ICON]));
    expect(savedSettings()).toMatchObject({ toolbarIcon: 'monochrome' });
    expect(chrome.localArea()).toMatchObject({
      toolbarIcon: 'monochrome',
      toolbarMode: 'dark',
    });
    expect(tile('Monochrome')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Monochrome follows Chrome live while the page is open', async () => {
    const mode = chromeMode(false);
    const user = userEvent.setup();
    const { chrome } = await renderDisplay();
    await user.click(tile('Monochrome'));
    await waitFor(() => expect(chrome.iconsSet).toEqual([DARK_ICON]));

    act(() => mode.setMatches(true));

    await waitFor(() =>
      expect(chrome.iconsSet).toEqual([DARK_ICON, LIGHT_ICON])
    );
    await waitFor(() =>
      expect(chrome.localArea()).toMatchObject({ toolbarMode: 'dark' })
    );
  });

  test('a page opened in Monochrome corrects the icon at once', async () => {
    chromeMode(true);
    const { chrome } = await renderWithProviders(<Page />, {
      seed: { action: {} },
      seedStore: (store) => {
        store.dispatch(selectCategory(SettingsCategory.DISPLAY));
        store.dispatch(setToolbarIcon('monochrome'));
      },
    });
    await waitFor(() => expect(chrome.iconsSet).toEqual([LIGHT_ICON]));
  });

  test('back to Colour restores the default icon and stops following', async () => {
    const mode = chromeMode(true);
    const user = userEvent.setup();
    const { chrome } = await renderDisplay();
    await user.click(tile('Monochrome'));
    await waitFor(() => expect(chrome.iconsSet).toEqual([LIGHT_ICON]));

    await user.click(tile('Color'));
    await waitFor(() => expect(chrome.iconsSet).toEqual([LIGHT_ICON, COLOUR]));

    act(() => mode.setMatches(false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(chrome.iconsSet).toEqual([LIGHT_ICON, COLOUR]);
  });

  test('worst path: a refused setIcon keeps the choice, so the next start applies it', async () => {
    chromeMode(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const { chrome } = await renderDisplay({
      action: { setIconRejects: true },
    });

    await user.click(tile('Monochrome'));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(savedSettings()).toMatchObject({ toolbarIcon: 'monochrome' });
    expect(chrome.localArea()).toMatchObject({
      toolbarIcon: 'monochrome',
      toolbarMode: 'dark',
    });
    expect(tile('Monochrome')).toHaveAttribute('aria-pressed', 'true');
  });

  test('shows the choice another page made', async () => {
    const { store } = await renderDisplay();
    act(() => {
      store.dispatch(setToolbarIcon('monochrome'));
    });
    await waitFor(() =>
      expect(tile('Monochrome')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  test.each([
    [false, '#f1f3f4'],
    [true, '#3c3c3c'],
  ] as const)(
    'with Chrome dark = %s both tiles sit on a %s toolbar, whatever the theme',
    async (dark, toolbar) => {
      chromeMode(dark);
      await renderDisplay({ action: {} }, dark ? Theme.CHALK : Theme.CHARCOAL);
      for (const name of ['Color', 'Monochrome'] as const) {
        const swatch = tile(name).querySelector('[data-swatch-tile]');
        expect(swatch).toHaveStyle({ backgroundColor: toolbar });
      }
    }
  );

  test('the tiles change with Chrome while the page is open', async () => {
    const mode = chromeMode(false);
    await renderDisplay();
    const swatch = () => tile('Monochrome').querySelector('[data-swatch-tile]');
    expect(swatch()).toHaveStyle({ backgroundColor: '#f1f3f4' });
    act(() => mode.setMatches(true));
    await waitFor(() =>
      expect(swatch()).toHaveStyle({ backgroundColor: '#3c3c3c' })
    );
  });

  test.each(['Color', 'Monochrome'] as const)(
    '%s shows the icon left of the puzzle piece and the ⋮, as Chrome does',
    async (name) => {
      await renderDisplay();
      const parts = [
        ...(tile(name).querySelector('[data-swatch-tile]')?.children ?? []),
      ].map((part) => part.getAttribute('data-toolbar-part'));
      expect(parts).toEqual(['icon', 'puzzle', 'menu']);
    }
  );

  test.each([
    [true, 'icons/toolbar-light-16.png'],
    [false, 'icons/toolbar-dark-16.png'],
  ] as const)(
    'with Chrome dark = %s, Monochrome shows %s',
    async (dark, file) => {
      chromeMode(dark);
      await renderDisplay();
      expect(tile('Monochrome').querySelector('img')).toHaveAttribute(
        'src',
        file
      );
    }
  );
});
