import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';

// KAN-87. Hovering a row made it look selected. Measured before the fix,
// SELECTION_COLOR against HOVER_COLOR was 1.21:1 on Light and 1.04:1 on Blue.
//
// The fix is NOT "make selection louder" -- two attempts at that were rejected
// (an accent bar, then a heavier ring elsewhere), and widening the whole ladder
// breaks text contrast on the dark themes and desaturates the coloured ones.
// It is "make hovering quieter": HOVER_COLOR moves toward PRIMARY_COLOR and
// SELECTION_COLOR is untouched, so each theme keeps its own hue.
//
// The rule below is what that means, stated so it cannot rot:
//
//     a hovered row must sit CLEARLY nearer the page than the selection
//
// Asserted as an ordering rather than as fixed hex values. A literal palette
// would make this a change detector that fails on any restyle; the ordering
// encodes the actual design decision, and it is what fails if someone later
// nudges HOVER_COLOR back toward SELECTION_COLOR.
//
// "Clearly" is a 1.1x margin rather than a bare `>`, and that is not
// decoration. On the first run of this test the old LIGHT palette PASSED a
// bare `>` -- 1.2109 from selection against 1.2100 from the page, a margin of
// 0.0009. Nobody could see that difference, so a bare ordering would have
// declared the worst-reported theme already correct.
//
// Note this deliberately does NOT assert 3:1 anywhere. WCAG 1.4.11 asks 3:1 to
// distinguish a UI state, and no value in this palette reaches it between hover
// and selection without making a selected row the lightest thing in the pane.
// That gap is real and stays open on the ticket; this pins the part that was
// actually decided.

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

describe('the row state ladder keeps hover nearer the page than selection', () => {
  test.each(Object.entries(THEMES))(
    '%s: hover is closer to the page than to the selection',
    (_name, theme) => {
      const fromPage = contrast(theme.HOVER_COLOR, theme.PRIMARY_COLOR);
      const fromSelection = contrast(theme.HOVER_COLOR, theme.SELECTION_COLOR);

      expect(
        fromSelection,
        `hover ${theme.HOVER_COLOR} sits ${fromSelection.toFixed(2)}:1 from ` +
          `selection ${theme.SELECTION_COLOR} but ${fromPage.toFixed(2)}:1 ` +
          `from the page ${theme.PRIMARY_COLOR} -- so it reads as selected`
      ).toBeGreaterThan(fromPage * 1.1);
    }
  );

  // CONTROL. The rule above is satisfied trivially by a hover identical to the
  // page -- no hover feedback at all, which is a different bug. Hovering has to
  // remain visible, so it must not collapse into the background.
  test.each(Object.entries(THEMES))(
    '%s: hover is still distinguishable from the page',
    (_name, theme) => {
      expect(theme.HOVER_COLOR).not.toBe(theme.PRIMARY_COLOR);
      expect(
        contrast(theme.HOVER_COLOR, theme.PRIMARY_COLOR),
        'hover must still be visible against the page'
      ).toBeGreaterThan(1.05);
    }
  );
});
