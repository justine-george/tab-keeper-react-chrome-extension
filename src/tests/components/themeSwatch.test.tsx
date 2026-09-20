import { describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { BLUE_THEME, DARKENHEIMER_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';

// KAN-237. Each theme is shown as a miniature of the popup, drawn from the
// theme's own tokens, with its name underneath.
//
// It was a flat 60x50 swatch of the page colour -- the height an accident of
// Button's padding around no text -- and Darkenheimer (#2A2A2A) and Blue
// (#2A2A3A) read as the same grey. The only name was a tooltip, and the
// buttons had no accessible name at all.
//
// jsdom paints nothing, so what is pinned here is the CONTRACT: which tokens
// each band carries, that the name is the control's name, that the state is on
// aria-pressed, and that the KAN-95 marker is on the active tile alone. The
// e2e measures that the marker reflows nothing.

const NAMES = ['Light', 'Warm Light', 'BB Pink', 'Darkenheimer', 'Blue'];

/** A colour as emotion wrote it, or as jsdom normalises it. */
const asWritten = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
};

const renderDisplay = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.DISPLAY));
    },
  });

const swatch = (name: string) => screen.getByRole('button', { name });
const tileOf = (name: string) =>
  swatch(name).querySelector<HTMLElement>('[data-theme-tile]')!;
const bandOf = (name: string, band: string) =>
  tileOf(name).querySelector<HTMLElement>(`[data-theme-band="${band}"]`)!;

describe('the theme picker shows each theme as a miniature (KAN-237)', () => {
  test('five buttons, each named after its theme, and nothing else in the picker', async () => {
    await renderDisplay();

    for (const name of NAMES) expect(swatch(name)).toBeTruthy();
    // The name is the button's accessible name -- visible text, not a title.
    expect(swatch('Blue').getAttribute('title')).toBeNull();
    expect(swatch('Blue')).toHaveAccessibleName('Blue');
  });

  test('the tile is presentational and its bands carry the theme own tokens', async () => {
    await renderDisplay();

    expect(tileOf('Blue').getAttribute('aria-hidden')).toBe('true');
    // The three surfaces a popup is made of, in Blue's colours -- which is
    // what finally tells Blue from Darkenheimer.
    expect(getComputedStyle(tileOf('Blue')).backgroundColor).toMatch(
      asWritten(BLUE_THEME.PRIMARY_COLOR)
    );
    expect(getComputedStyle(bandOf('Blue', 'header')).backgroundColor).toMatch(
      asWritten(BLUE_THEME.SECONDARY_COLOR)
    );
    expect(
      getComputedStyle(bandOf('Blue', 'selection')).backgroundColor
    ).toMatch(asWritten(BLUE_THEME.SELECTION_COLOR));

    // CONTROL: a different theme's tile carries different tokens, so the
    // assertions above are reading this tile and not a shared style.
    expect(getComputedStyle(tileOf('Darkenheimer')).backgroundColor).toMatch(
      asWritten(DARKENHEIMER_THEME.PRIMARY_COLOR)
    );
    expect(BLUE_THEME.PRIMARY_COLOR).not.toBe(DARKENHEIMER_THEME.PRIMARY_COLOR);
  });

  test('exactly one is pressed, and its tile alone wears the 2px LABEL_L3 marker', async () => {
    const { store } = await renderDisplay();
    act(() => {
      store.dispatch(setTheme(Theme.BB_PINK));
    });

    const pressed = NAMES.filter(
      (n) => swatch(n).getAttribute('aria-pressed') === 'true'
    );
    expect(pressed).toEqual(['BB Pink']);
    for (const n of NAMES) {
      if (n === 'BB Pink') continue;
      expect(swatch(n).getAttribute('aria-pressed')).toBe('false');
    }

    // The marker is the tile's own border, thickened (KAN-95), in the PAGE's
    // LABEL_L3 -- the active page is BB Pink here, so its token.
    const active = getComputedStyle(tileOf('BB Pink'));
    expect(active.borderTopWidth).toBe('2px');
    // Every other tile keeps the 1px frame.
    expect(getComputedStyle(tileOf('Light')).borderTopWidth).toBe('1px');
  });

  test('activating a swatch selects its theme', async () => {
    const user = userEvent.setup();
    const { store } = await renderDisplay();
    expect(store.getState().settingsDataState.theme).toBe(Theme.LIGHT);

    await user.click(swatch('Warm Light'));
    expect(store.getState().settingsDataState.theme).toBe(Theme.WARM_LIGHT);

    // And the keyboard: a real button, so Space activates it.
    swatch('Blue').focus();
    await user.keyboard(' ');
    expect(store.getState().settingsDataState.theme).toBe(Theme.BLUE);
  });

  test('the name is inside the button, under the tile', async () => {
    await renderDisplay();
    const button = swatch('Warm Light');
    // Text node inside the button, not a title and not a sibling.
    expect(within(button).getByText('Warm Light')).toBeTruthy();
    // The tile comes first, the name second: the picture is what is looked
    // at, the word confirms it.
    const children = Array.from(button.children);
    expect(children[0].hasAttribute('data-theme-tile')).toBe(true);
    expect(children[1].textContent).toBe('Warm Light');
  });
});
