import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-669. The row a carry rests on, and the sweep that counts down to its
// spring-open, paint the press fill. They painted hover, 1.06:1 off the list
// in Parchment and 1.07 in Graphite and Ink, where the sweep could hardly be
// seen. The press fill is ~1.45:1 in every theme.
//
// The 2px LABEL_L2 outline sits on that fill. The light themes hold 3:1; the
// dark ones sit just under it on purpose, as KAN-668's control edges do.

// Each theme with the floor its outline is held to on the press fill.
const THEMES = {
  LIGHT: { theme: LIGHT_THEME, outlineFloor: 3 },
  WARM_LIGHT: { theme: WARM_LIGHT_THEME, outlineFloor: 3 },
  BB_PINK: { theme: BB_PINK_THEME, outlineFloor: 3 },
  DARKENHEIMER: { theme: DARKENHEIMER_THEME, outlineFloor: 2.95 },
  BLUE: { theme: BLUE_THEME, outlineFloor: 2.95 },
};

const FILL_FLOOR = 1.4;

describe('the carry target and its sweep can be seen in every theme', () => {
  test.each(Object.entries(THEMES))(
    '%s: the press fill stands off the list',
    (_name, { theme }) => {
      const ratio = contrast(theme.ACTIVE_COLOR, theme.PRIMARY_COLOR);
      expect(
        ratio,
        `press fill ${theme.ACTIVE_COLOR} is ${ratio.toFixed(2)}:1 on ${theme.PRIMARY_COLOR}`
      ).toBeGreaterThanOrEqual(FILL_FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: the outline clears its floor on the press fill',
    (_name, { theme, outlineFloor }) => {
      const ratio = contrast(theme.LABEL_L2_COLOR, theme.ACTIVE_COLOR);
      expect(
        ratio,
        `outline ${theme.LABEL_L2_COLOR} is ${ratio.toFixed(2)}:1 on ${theme.ACTIVE_COLOR}`
      ).toBeGreaterThanOrEqual(outlineFloor);
    }
  );
});
