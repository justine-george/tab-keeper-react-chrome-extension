import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-188. The scrollbar thumb was close to invisible in every theme. Measured
// in the built popup before the fix, thumb against its own track:
//
//     Light 1.08:1 (the thumb LIGHTER than the track), Warm Light 1.13:1,
//     BB Pink, Darkenheimer and Blue 1.28:1
//
// Chrome's own light scrollbar is 1.59:1. Light had 3.16:1 until KAN-22 wired
// these tokens up in v1.4.1 -- they had never been rendered before that, and
// nobody looked at the paint, only at the custom property arriving.
//
// The design chosen is a floating thumb: no visible track in any theme, and a
// thumb that steps further from the pane on hover and again while held. The
// rules below state that as ratios against the pane, not as hex, so a restyle
// that keeps the thumb visible passes and one that loses it does not.
//
// Distance from the pane rather than "darker" or "lighter": the right
// direction is opposite on light and dark grounds, and distance is what both
// have in common (the same reasoning as KAN-93 in themeStateLadder.test.ts).
//
// What these cannot see is whether App.css actually paints the tokens -- in
// particular whether the held state has a `:active` rule at all. That is
// e2e/scrollbar-visibility.spec.ts, against real pixels.

const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};

// The floor for a thumb at rest. Above Chrome's own 1.59:1, so it is at least
// as findable as the browser default; below the 3:1 of option B, which was
// judged too loud on BB Pink. 1.9 rather than 2.0 so a one-step rounding of a
// hex channel does not fail a thumb nobody could tell apart.
const REST_FLOOR = 1.9;

// A state change has to be visible as a change. 1.2x further from the pane is
// roughly one clearly distinguishable step on this ladder; the old hover sat
// 1.10x from rest on Light and 1.15x on Darkenheimer, and read as no change.
const STEP = 1.2;

describe('the scrollbar thumb is visible and each state steps away from the pane (KAN-188)', () => {
  test.each(Object.entries(THEMES))(
    '%s: the thumb at rest is findable against the pane',
    (_name, theme) => {
      const rest = contrast(theme.SCROLLBAR_THUMB, theme.PRIMARY_COLOR);
      expect(
        rest,
        `thumb ${theme.SCROLLBAR_THUMB} is only ${rest.toFixed(2)}:1 against ` +
          `the pane ${theme.PRIMARY_COLOR}`
      ).toBeGreaterThanOrEqual(REST_FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: hovering moves the thumb visibly further from the pane',
    (_name, theme) => {
      const rest = contrast(theme.SCROLLBAR_THUMB, theme.PRIMARY_COLOR);
      const hover = contrast(theme.SCROLLBAR_THUMB_HOVER, theme.PRIMARY_COLOR);
      expect(
        hover,
        `hover ${theme.SCROLLBAR_THUMB_HOVER} is ${hover.toFixed(2)}:1 from ` +
          `the pane against rest at ${rest.toFixed(2)}:1 -- not a visible step`
      ).toBeGreaterThanOrEqual(rest * STEP);
    }
  );

  // Before KAN-188 there was no held colour: holding the thumb matched
  // `:hover` and looked identical to hovering it.
  test.each(Object.entries(THEMES))(
    '%s: holding moves the thumb visibly further than hovering',
    (_name, theme) => {
      expect(theme).toHaveProperty('SCROLLBAR_THUMB_ACTIVE');
      const hover = contrast(theme.SCROLLBAR_THUMB_HOVER, theme.PRIMARY_COLOR);
      const held = contrast(theme.SCROLLBAR_THUMB_ACTIVE, theme.PRIMARY_COLOR);
      const heldRatio = held.toFixed(2);
      const hoverRatio = hover.toFixed(2);
      expect(
        held,
        `held ${theme.SCROLLBAR_THUMB_ACTIVE} is ${heldRatio}:1 from the ` +
          `pane against hover at ${hoverRatio}:1 -- not a visible step`
      ).toBeGreaterThanOrEqual(hover * STEP);
    }
  );

  // The selected session is the row beside the thumb whenever the list is at
  // the top. In four themes SCROLLBAR_THUMB WAS SELECTION_COLOR, so the two
  // merged at 1.00:1 and the selected row looked 10px wider than the rest.
  test.each(Object.entries(THEMES))(
    '%s: the thumb does not merge into the selected row beside it',
    (_name, theme) => {
      const fromSelection = contrast(
        theme.SCROLLBAR_THUMB,
        theme.SELECTION_COLOR
      );
      const ratio = fromSelection.toFixed(2);
      expect(
        fromSelection,
        `thumb ${theme.SCROLLBAR_THUMB} is ${ratio}:1 from the selected ` +
          `row ${theme.SELECTION_COLOR}`
      ).toBeGreaterThanOrEqual(1.3);
    }
  );

  // CONTROL for the floating design. Every rule above measures the thumb
  // against the PANE, which is only the right backdrop if no track is drawn
  // between them. A visible track would make them all measure the wrong pair.
  test.each(Object.entries(THEMES))(
    '%s: no track is drawn between the thumb and the pane',
    (_name, theme) => {
      const trackFromPane = contrast(
        theme.SCROLLBAR_TRACK,
        theme.PRIMARY_COLOR
      );
      expect(
        trackFromPane,
        `track ${theme.SCROLLBAR_TRACK} is ${trackFromPane.toFixed(2)}:1 ` +
          `from the pane ${theme.PRIMARY_COLOR}, so it shows`
      ).toBeLessThanOrEqual(1.01);
    }
  );
});
