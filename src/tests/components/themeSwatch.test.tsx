import { describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  CHALK_THEME,
  DARKENHEIMER_THEME,
} from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';
import { asWritten } from '../setup/asWritten';

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

const NAMES = [
  'Chalk',
  'Paper',
  'Parchment',
  'Petal',
  'Charcoal',
  'Graphite',
  'Ink',
];

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
  test('seven buttons, each named after its theme, and nothing else in the picker', async () => {
    await renderDisplay();

    for (const name of NAMES) expect(swatch(name)).toBeTruthy();
    // The name is the button's accessible name -- visible text, not a title.
    expect(swatch('Ink').getAttribute('data-tooltip')).toBeNull();
    expect(swatch('Ink')).toHaveAccessibleName('Ink');
  });

  test('the tile is presentational and its bands carry the theme own tokens', async () => {
    await renderDisplay();

    expect(tileOf('Ink').getAttribute('aria-hidden')).toBe('true');
    // The three surfaces a popup is made of, in Blue's colours -- which is
    // what finally tells Blue from Darkenheimer.
    expect(getComputedStyle(tileOf('Ink')).backgroundColor).toMatch(
      asWritten(BLUE_THEME.PRIMARY_COLOR)
    );
    expect(getComputedStyle(bandOf('Ink', 'header')).backgroundColor).toMatch(
      asWritten(BLUE_THEME.SECONDARY_COLOR)
    );
    expect(
      getComputedStyle(bandOf('Ink', 'selection')).backgroundColor
    ).toMatch(asWritten(BLUE_THEME.SELECTION_COLOR));

    // CONTROL: a different theme's tile carries different tokens, so the
    // assertions above are reading this tile and not a shared style.
    expect(getComputedStyle(tileOf('Graphite')).backgroundColor).toMatch(
      asWritten(DARKENHEIMER_THEME.PRIMARY_COLOR)
    );
    expect(BLUE_THEME.PRIMARY_COLOR).not.toBe(DARKENHEIMER_THEME.PRIMARY_COLOR);
  });

  test('the picker lists the seven in order, light then dark', async () => {
    await renderDisplay();
    const row = swatch('Paper').parentElement;
    if (!row) throw new Error('Paper has no picker row');
    expect(
      Array.from(row.querySelectorAll('button')).map(
        (b) => b.children[1].textContent
      )
    ).toEqual(NAMES);
  });

  test("a Chalk tile carries Chalk's own tokens", async () => {
    await renderDisplay();
    expect(getComputedStyle(tileOf('Chalk')).backgroundColor).toMatch(
      asWritten(CHALK_THEME.PRIMARY_COLOR)
    );
    expect(getComputedStyle(bandOf('Chalk', 'header')).backgroundColor).toMatch(
      asWritten('#F3F5F7')
    );
  });

  test('exactly one is pressed, and its tile alone wears the 2px LABEL_L1 marker and the check', async () => {
    const { store } = await renderDisplay();
    act(() => {
      store.dispatch(setTheme(Theme.BB_PINK));
    });

    const pressed = NAMES.filter(
      (n) => swatch(n).getAttribute('aria-pressed') === 'true'
    );
    expect(pressed).toEqual(['Petal']);
    for (const n of NAMES) {
      if (n === 'Petal') continue;
      expect(swatch(n).getAttribute('aria-pressed')).toBe('false');
    }

    // The tile's own border, thickened (KAN-95), in the PAGE's LABEL_L1 (KAN-398).
    const active = getComputedStyle(tileOf('Petal'));
    expect(active.borderTopWidth).toBe('2px');
    expect(active.borderTopColor).toMatch(
      asWritten(BB_PINK_THEME.LABEL_L1_COLOR)
    );
    // Every other tile keeps the 1px frame.
    expect(getComputedStyle(tileOf('Paper')).borderTopWidth).toBe('1px');

    // The check: on the current tile only, hidden from the name it sits beside.
    const checks = NAMES.filter(
      (n) => swatch(n).querySelector('[data-theme-check]') !== null
    );
    expect(checks).toEqual(['Petal']);
    expect(
      swatch('Petal')
        .querySelector('[data-theme-check]')
        ?.closest('[aria-hidden="true"]')
    ).not.toBeNull();
  });

  test('activating a swatch selects its theme', async () => {
    const user = userEvent.setup();
    const { store } = await renderDisplay();
    expect(store.getState().settingsDataState.theme).toBe(Theme.LIGHT);

    await user.click(swatch('Parchment'));
    expect(store.getState().settingsDataState.theme).toBe(Theme.WARM_LIGHT);

    // And the keyboard: a real button, so Space activates it.
    swatch('Ink').focus();
    await user.keyboard(' ');
    expect(store.getState().settingsDataState.theme).toBe(Theme.BLUE);
  });

  test('the name is inside the button, under the tile', async () => {
    await renderDisplay();
    const button = swatch('Parchment');
    // Text node inside the button, not a title and not a sibling.
    expect(within(button).getByText('Parchment')).toBeTruthy();
    // The tile comes first, the name second: the picture is what is looked
    // at, the word confirms it.
    const children = Array.from(button.children);
    expect(children[0].querySelector('[data-theme-tile]')).not.toBeNull();
    expect(children[1].textContent).toBe('Parchment');
  });
});

// KAN-247. 14px between tiles in a four-column grid (ja's katakana captions outgrow their tiles); theme-swatch-marker.spec pins it in a browser.
describe('the theme picker spaces its tiles (KAN-247)', () => {
  test('the row gap is 14px', async () => {
    await renderDisplay();
    const row = swatch('Paper').parentElement;
    if (!row) throw new Error('Paper has no picker row');
    expect(getComputedStyle(row).gap).toBe('14px');
    // A grid of four columns: seven tiles fall as four over three.
    expect(getComputedStyle(row).gridTemplateColumns).toBe(
      'repeat(4, max-content)'
    );
    // CONTROL: the element read is the picker row, holding all seven.
    expect(row.querySelectorAll('[data-theme-tile]').length).toBe(7);
  });
});
