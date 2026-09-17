import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-214. The session header's "Add current window" is a tinted chip: no
// border, a resting fill a step away from the card it sits on (SECONDARY_COLOR),
// hovering to ICON_HOVER_COLOR and pressing to ICON_ACTIVE_COLOR.
//
// CHIP_COLOR is 1.20:1 against the card, not the 1.35:1 first picked, and the
// reason is the ladder above it. Measured at 1.35:1:
//   - hovering to ICON_HOVER_COLOR was a 1.05-1.085:1 step: no visible hover;
//   - hovering to ICON_ACTIVE_COLOR and pressing one step deeper put the label
//     at 4.04 / 4.08 / 4.45:1 while pressed in Blue / Darkenheimer / Light.
// A chip at the floor leaves room for both steps using the icon tokens that
// already exist.
//
// Stated as relations rather than hex values, so a restyle that keeps the
// ladder readable passes and one that collapses a step does not.

const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};

// dividerContrast.test.ts's floor for a surface that can still be seen.
const VISIBLE_FLOOR = 1.2;

// The weakest hover -> press step the icon tokens already take in any theme
// (BB Pink, 1.163:1). Every icon in the app presses by this much, so a chip
// that hovers by less would be the quietest state change on screen.
const ICON_STEP = 1.16;

// WCAG AA for the chip's 13px label.
const LABEL_FLOOR = 4.5;

describe('the add-window chip is a visible fill with room for hover and press', () => {
  test.each(Object.entries(THEMES))(
    '%s: the resting chip can be seen against its card',
    (_name, theme) => {
      const ratio = contrast(theme.CHIP_COLOR, theme.SECONDARY_COLOR);
      expect(
        ratio,
        `chip ${theme.CHIP_COLOR} is ${ratio.toFixed(3)}:1 against the card ${
          theme.SECONDARY_COLOR
        }`
      ).toBeGreaterThanOrEqual(VISIBLE_FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: hover is a visible step past rest, in the same direction',
    (_name, theme) => {
      const step = contrast(theme.CHIP_COLOR, theme.ICON_HOVER_COLOR);
      expect(
        step,
        `rest ${theme.CHIP_COLOR} -> hover ${
          theme.ICON_HOVER_COLOR
        } is only ${step.toFixed(3)}:1`
      ).toBeGreaterThanOrEqual(ICON_STEP);
      // Further from the card, not back toward it: a hover that lightened a
      // chip on a light card would read as the chip switching off.
      expect(
        contrast(theme.ICON_HOVER_COLOR, theme.SECONDARY_COLOR)
      ).toBeGreaterThan(contrast(theme.CHIP_COLOR, theme.SECONDARY_COLOR));
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: the label stays readable at rest, hover and press',
    (_name, theme) => {
      for (const [state, fill] of [
        ['rest', theme.CHIP_COLOR],
        ['hover', theme.ICON_HOVER_COLOR],
        ['press', theme.ICON_ACTIVE_COLOR],
      ]) {
        const ratio = contrast(theme.TEXT_COLOR, fill);
        expect(
          ratio,
          `label on ${state} (${fill}) is ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(LABEL_FLOOR);
      }
    }
  );
});
