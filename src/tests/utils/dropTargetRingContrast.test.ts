import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  dropTargetRingColor,
} from '../../hooks/useThemeColors';

// KAN-164. While a tab is dragged, the group whose band it would join is ringed
// -- and a marker nobody can see is the bug this shipped to fix.
//
// The ring is drawn OUTSIDE the band, so its backdrop is always the page. That
// is the whole reason it can be measured at all: inset, its left segment would
// cross the group's colour strip, which is one of Chrome's nine fixed pastels,
// and the app's text colour measures 1.05:1 against cyan on the dark themes.
//
// The rule stated so it cannot rot:
//
//     the drop-target ring must clear 3:1 against the page, in every theme
//
// 3:1 is the WCAG 1.4.11 floor for a non-text control that carries meaning.
// Asserted against `dropTargetRingColor` rather than a hex literal, so this is
// the same value the component draws rather than a copy of the decision --
// swapping the token in one place fails here instead of silently shipping.
//
// Measured when this was written: LABEL_L2 3.62:1 at worst, LABEL_L1 6.58,
// TEXT_COLOR 9.24 (legible but far too loud), LABEL_L3 2.56 and BORDER_COLOR
// 1.38 -- the last two fail, and LABEL_L3 is the same token KAN-124 caught
// being invisible in a different place.
const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};

/** Relative luminance, per WCAG 2.x. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.substr(i, 2), 16) / 255)
    .map((v) =>
      v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('the drop-target ring stays legible against the page', () => {
  test.each(Object.entries(THEMES))(
    '%s: the ring clears the 3:1 floor',
    (_name, theme) => {
      expect(
        contrast(dropTargetRingColor(theme), theme.PRIMARY_COLOR)
      ).toBeGreaterThanOrEqual(3);
    }
  );
});
