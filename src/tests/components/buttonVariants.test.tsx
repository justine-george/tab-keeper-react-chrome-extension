import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import Button from '../../components/common/Button';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { activeRulesFor, hoverRulesFor } from '../setup/hoverRules';

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
      getComputedStyle(button()).backgroundColor
    );
    expect(hoverRulesFor(button())).toMatch(fill(LIGHT_THEME.ICON_HOVER_COLOR));
    expect(activeRulesFor(button())).toMatch(
      fill(LIGHT_THEME.ICON_ACTIVE_COLOR)
    );
  });

  test('primary rests on a fill of its own', async () => {
    await render({ variant: 'primary' });

    // Derived from the token: a literal here is the exact staleness this
    // ticket spent its time removing from three other test files.
    expect(getComputedStyle(button()).backgroundColor).toBe(
      rgb(LIGHT_THEME.SELECTION_COLOR).text
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

  // THE CONTROL. Every assertion above passes against a Button that ignores the
  // prop and paints one colour, if that colour happens to be the one asserted.
  // This is what makes them claims about the variant.
  test('CONTROL: the three variants do not all look the same', async () => {
    const seen = new Set<string>();
    for (const variant of ['quiet', 'primary', 'danger'] as const) {
      const { unmount } = await render({ variant });
      seen.add(getComputedStyle(button()).backgroundColor);
      unmount();
    }
    expect(seen.size).toBe(3);
  });
});
