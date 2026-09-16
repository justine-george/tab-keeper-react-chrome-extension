import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-205. One ladder for every transient interaction, identical in every
// theme, with a pressed step that did not exist at all.
//
// The audit that produced this (all five themes, every token, 2026-09-16):
//
//   * hover sat at 1.058-1.156 from the page -- BELOW the 1.20 that
//     dividerContrast.test.ts already calls "can still be seen", in every
//     theme, and landing on a different number in each;
//   * there was no pressed state anywhere in the product. The scrollbar was
//     the only element with three steps, and the only one consistent across
//     themes: 2.00 / 3.00 / 4.00 against its track, every theme;
//   * hover was that quiet ON PURPOSE (KAN-87: a hovered row read as
//     selected), because hover and selection were competing for one channel --
//     how far the fill sits from the page.
//
// What shipped is the PRESSED rung only.
//
// Raising hover to a shared rung was built and reverted: it put a hovered row
// 1.01-1.03:1 from a selected one on Warm Light and the dark themes, and both
// ways of giving selection a second channel were rejected -- an edge marker
// read as a rail, a heavier title as arbitrary emphasis. Hover therefore keeps
// its per-theme values and KAN-87's rule (themeStateLadder.test.ts).
//
// Pressing is free of that argument because it adds a rung BEYOND hover rather
// than between hover and selection, so it cannot crowd selection from below. It
// DOES land further from the page than a selected row on three themes, which is
// fine and deliberate: a press lasts as long as a finger is down on a row the
// user is already touching, so there is nothing to confuse it with.
//
// Stated as a cross-theme band, never as hex values. The band is the point: a
// per-theme number is how the rest of this drifted.

const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};
const ALL = Object.entries(THEMES);

/** One clearly visible step on this palette, as KAN-87 established. */
const CLEAR_STEP = 1.1;

/**
 * How far any theme may sit from the ladder's nominal ratios.
 *
 * Deliberately tight. The defect this pins is not "hover is wrong on
 * Darkenheimer", it is "hover means something different on every theme", and a
 * loose band would let that back in one nudge at a time.
 */
const NOMINAL_PRESSED = 1.45;
const BAND = 0.04;

describe('the transient interaction ladder (KAN-205)', () => {
  test.each(ALL)('%s: there is a pressed state at all', (_n, theme) => {
    expect(theme).toHaveProperty('ACTIVE_COLOR');
    expect(theme.ACTIVE_COLOR).not.toBe(theme.HOVER_COLOR);
    expect(theme.ACTIVE_COLOR).not.toBe(theme.PRIMARY_COLOR);
  });

  test.each(ALL)(
    '%s: pressing reads as one clear step beyond hovering',
    (_n, theme) => {
      const hover = contrast(theme.HOVER_COLOR, theme.PRIMARY_COLOR);
      const pressed = contrast(theme.ACTIVE_COLOR, theme.PRIMARY_COLOR);

      expect(
        pressed,
        `pressed ${theme.ACTIVE_COLOR} is ${pressed.toFixed(3)}:1 from the ` +
          `page and hover ${theme.HOVER_COLOR} is ${hover.toFixed(3)}:1 -- ` +
          `a press must be further out than a hover, clearly`
      ).toBeGreaterThan(hover * CLEAR_STEP);
    }
  );

  test.each(ALL)('%s: pressed sits on the shared rung', (_n, theme) => {
    expect(
      Math.abs(
        contrast(theme.ACTIVE_COLOR, theme.PRIMARY_COLOR) - NOMINAL_PRESSED
      )
    ).toBeLessThanOrEqual(BAND);
  });

  // KAN-93 still holds: a hovered icon sits INSIDE a hovered row, so it has to
  // read as more engaged than the row, or it punches a hole in the fill.
  // Raising the row's hover is exactly the change that could break this.
  test.each(ALL)(
    '%s: a hovered icon is still more engaged than its row',
    (_n, theme) => {
      expect(
        contrast(theme.ICON_HOVER_COLOR, theme.PRIMARY_COLOR)
      ).toBeGreaterThan(contrast(theme.HOVER_COLOR, theme.PRIMARY_COLOR));
    }
  );
});

// Selection is NOT in this file, on purpose. It is carried by the selected
// row's title weight (see TabGroupEntry), which is not a colour and so has no
// token relation to assert -- that is the point of moving it off the fill. The
// rendered claim lives in selectedRowEmphasis.test.tsx.
