import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-204. DELETE_ICON_HOVER_COLOR is a red BACKGROUND -- Icon.tsx uses it as
// the hover fill behind every row delete icon, and OverflowMenu as the fill
// behind a danger item. The content on it stays at TEXT_COLOR.
//
// That content includes a LABEL, at 0.85rem. Normal-size text, so WCAG 1.4.3
// asks 4.5:1 -- not the 3:1 that would apply to a glyph alone. Measured from
// painted pixels in a real build across all five themes, only one passed:
//
//   Light         #FF8080 on #3B3D40   4.4884   fails by hundredths
//   Warm Light    #FF8C8C on #28251F   6.8250   passes
//   BB Pink       #FF5252 on #2A2A2A   4.4979   fails by hundredths
//   Darkenheimer  #E57373 on #D0D0D0   1.9363   fails badly
//   Blue          #E5739A on #D0D0DF   1.8992   fails badly
//
// The two dark themes are the real defect. The comment in OverflowMenu states
// the intent as "a red FILL behind a dark glyph", which is true on the three
// light themes, where TEXT_COLOR is near-black. On Darkenheimer and Blue
// TEXT_COLOR is #D0D0D0, so the same rule paints a light glyph on a light red
// and the whole row all but disappears.
//
// Stated as relations rather than hex values, so a restyle that keeps the fill
// readable and still destructive-looking passes, and one that loses either does
// not.

const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};

/** WCAG 1.4.3 for normal-size text. The label on the fill is 0.85rem. */
const TEXT_FLOOR = 4.5;

/**
 * A destructive hover must not look like an ordinary one.
 *
 * The two fills sit on the same ground, so comparing each to the ground says
 * nothing about telling them apart; this compares them to EACH OTHER. 1.2 is
 * the floor dividerContrast.test.ts already uses for "can still be seen" on
 * this palette.
 */
const APART_FROM_ORDINARY_HOVER = 1.2;

describe('the delete hover fill carries readable text (KAN-204)', () => {
  test.each(Object.entries(THEMES))(
    '%s: the label on the fill clears 4.5:1',
    (_name, theme) => {
      expect(theme).toHaveProperty('DELETE_ICON_HOVER_COLOR');
      expect(
        contrast(theme.TEXT_COLOR, theme.DELETE_ICON_HOVER_COLOR)
      ).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: a destructive hover still reads as different from an ordinary one',
    (_name, theme) => {
      expect(
        contrast(theme.DELETE_ICON_HOVER_COLOR, theme.HOVER_COLOR)
      ).toBeGreaterThanOrEqual(APART_FROM_ORDINARY_HOVER);
    }
  );

  // THE CONTROL. Both assertions above are satisfied by painting the fill the
  // same colour as the page ground and letting the text sit on that -- which
  // would pass while deleting the destructive cue entirely. The fill has to be
  // a fill.
  test.each(Object.entries(THEMES))(
    'CONTROL: %s: the fill is not simply the menu ground',
    (_name, theme) => {
      expect(theme.DELETE_ICON_HOVER_COLOR).not.toBe(theme.PRIMARY_COLOR);
      expect(
        contrast(theme.DELETE_ICON_HOVER_COLOR, theme.PRIMARY_COLOR)
      ).toBeGreaterThanOrEqual(APART_FROM_ORDINARY_HOVER);
    }
  );
});
