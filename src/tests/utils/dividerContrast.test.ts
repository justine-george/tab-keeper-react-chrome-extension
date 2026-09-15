import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// The line between rows in the session list and the Settings category list
// is <Divider/>. It was drawn in BORDER_COLOR, which on Light is near-black:
// 7.54:1 against the pane, where every other theme sat at 1.38-1.73:1. It read
// as a hard rule, and its stop at the scrollbar gutter read as a cut.
//
// The fix chosen is a quieter line with the same geometry, in its own token.
// Not a lighter BORDER_COLOR: that token also draws pane borders, inputs,
// buttons and modals, and softening it would soften all of them.
//
// Stated as two relations rather than hex values, so a restyle that keeps the
// line quiet and visible passes and one that loses either does not.

const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};

// Below this a 1px line against the pane effectively disappears.
const VISIBLE_FLOOR = 1.2;

// A separator is structure, the scrollbar thumb is a control. The line has to
// read clearly quieter than the thumb at rest, and 1.3x is one clearly visible
// step on this palette's ladders (see scrollbarLadder.test.ts).
const QUIETER_THAN_THUMB = 1.3;

describe('the row divider is a quiet, visible line', () => {
  test.each(Object.entries(THEMES))(
    '%s: the divider can still be seen against the pane',
    (_name, theme) => {
      expect(theme).toHaveProperty('DIVIDER_COLOR');
      const fromPane = contrast(theme.DIVIDER_COLOR, theme.PRIMARY_COLOR);
      expect(
        fromPane,
        `divider ${theme.DIVIDER_COLOR} is ${fromPane.toFixed(2)}:1 against ` +
          `the pane ${theme.PRIMARY_COLOR}`
      ).toBeGreaterThanOrEqual(VISIBLE_FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: the divider is clearly quieter than the resting scrollbar thumb',
    (_name, theme) => {
      expect(theme).toHaveProperty('DIVIDER_COLOR');
      const line = contrast(theme.DIVIDER_COLOR, theme.PRIMARY_COLOR);
      const thumb = contrast(theme.SCROLLBAR_THUMB, theme.PRIMARY_COLOR);
      const lineRatio = line.toFixed(2);
      const thumbRatio = thumb.toFixed(2);
      expect(
        line * QUIETER_THAN_THUMB,
        `divider ${theme.DIVIDER_COLOR} is ${lineRatio}:1 against the pane ` +
          `and the thumb only ${thumbRatio}:1 -- the line is the louder one`
      ).toBeLessThanOrEqual(thumb);
    }
  );
});
