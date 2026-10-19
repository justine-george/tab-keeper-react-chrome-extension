import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import Button from '../../components/common/Button';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { activeRulesFor, hoverRulesFor } from '../setup/hoverRules';
import { mixHex } from '../../styles/mixHex';

// KAN-205. 22 components carry an onClick; 7 imported Button. The other 15 each
// built their own clickable surface, which is where the inconsistency people
// see actually comes from -- not from Button being wrong, but from Button only
// knowing how to look one way.
//
// Three named kinds cover every one of them, and `quiet` is the default so no
// existing caller changes.

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return {
    text: `rgb(${r}, ${g}, ${b})`,
    pattern: new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i'),
  };
};
/** Matches a colour as emotion writes it or as jsdom normalises it. */
const fill = (hex: string) => rgb(hex).pattern;

const render = (props = {}) =>
  renderWithProviders(
    <Button text="Act" onClick={() => undefined} {...props} />
  );
const button = () => screen.getByRole('button', { name: 'Act' });

describe('Button variants (KAN-205)', () => {
  test('defaults to quiet, so every existing caller is unchanged', async () => {
    await render();

    expect(getComputedStyle(button()).backgroundColor).toBe(
      rgb(LIGHT_THEME.PRIMARY_COLOR).text
    );
    expect(hoverRulesFor(button())).toMatch(fill(LIGHT_THEME.ICON_HOVER_COLOR));
    expect(activeRulesFor(button())).toMatch(
      fill(LIGHT_THEME.ICON_ACTIVE_COLOR)
    );
  });

  // KAN-511. Drawn as the dialogs draw their main action (KAN-501): the text colour as the fill, the page's ground as the ink.
  test('primary is the filled main action: text-colour fill, ground-colour label and icon', async () => {
    await render({ variant: 'primary', iconType: 'star' });

    // Derived from the token: a literal here is the exact staleness this
    // ticket spent its time removing from three other test files.
    expect(getComputedStyle(button()).backgroundColor).toBe(
      rgb(LIGHT_THEME.TEXT_COLOR).text
    );
    expect(getComputedStyle(button()).color).toBe(
      rgb(LIGHT_THEME.PRIMARY_COLOR).text
    );
    expect(getComputedStyle(button()).border).toContain(
      rgb(LIGHT_THEME.TEXT_COLOR).text
    );
    const glyph = button().querySelector('.material-symbols-outlined');
    expect(glyph && getComputedStyle(glyph).color).toBe(
      rgb(LIGHT_THEME.PRIMARY_COLOR).text
    );
    expect(hoverRulesFor(button())).toMatch(
      fill(mixHex(LIGHT_THEME.TEXT_COLOR, LIGHT_THEME.PRIMARY_COLOR, 0.88))
    );
    expect(activeRulesFor(button())).toMatch(
      fill(mixHex(LIGHT_THEME.TEXT_COLOR, LIGHT_THEME.PRIMARY_COLOR, 0.76))
    );
  });

  test('quiet keeps the text colour for its label', async () => {
    await render();

    expect(getComputedStyle(button()).color).toBe(
      rgb(LIGHT_THEME.TEXT_COLOR).text
    );
  });

  test('danger rests on the delete fill', async () => {
    await render({ variant: 'danger' });

    expect(getComputedStyle(button()).backgroundColor).toBe(
      rgb(LIGHT_THEME.DELETE_ICON_HOVER_COLOR).text
    );
  });

  // Measured in KAN-204: at the delete hue there is no lightness that deepens
  // the fill and keeps its label above 4.5:1, so it holds its colour instead of
  // getting harder to read as you commit to it.
  test('danger holds its red through hover and press', async () => {
    await render({ variant: 'danger' });

    const red = fill(LIGHT_THEME.DELETE_ICON_HOVER_COLOR);
    expect(hoverRulesFor(button())).toMatch(red);
    expect(activeRulesFor(button())).toMatch(red);
  });
});

describe('Button outline variant (KAN-394)', () => {
  test('rests transparent with a panel edge, hovers and presses on the icon fills', async () => {
    await renderWithProviders(
      <Button text="Act" variant="outline" onClick={() => undefined} />
    );
    const el = screen.getByRole('button', { name: 'Act' });
    expect(getComputedStyle(el).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(el).border).toContain(
      rgb(LIGHT_THEME.PANEL_BORDER_COLOR).text
    );
    expect(hoverRulesFor(el)).toMatch(fill(LIGHT_THEME.ICON_HOVER_COLOR));
    expect(activeRulesFor(el)).toMatch(fill(LIGHT_THEME.ICON_ACTIVE_COLOR));
  });
});
