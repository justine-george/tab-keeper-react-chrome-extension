import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  CHALK_THEME,
  CHARCOAL_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-673. The tag (the / key, This window) sits on the page. Light themes
// draw it with an edge, dark themes with a fill; one of them must show.
const VISIBLE_FLOOR = 1.2;

const ALL: [string, ThemeColors][] = [
  ['LIGHT', LIGHT_THEME],
  ['CHALK', CHALK_THEME],
  ['WARM_LIGHT', WARM_LIGHT_THEME],
  ['BB_PINK', BB_PINK_THEME],
  ['DARKENHEIMER', DARKENHEIMER_THEME],
  ['BLUE', BLUE_THEME],
  ['CHARCOAL', CHARCOAL_THEME],
];

describe('the tag stands out from the page', () => {
  test.each(ALL)('%s', (_name, theme) => {
    const edge = contrast(theme.TAG_BORDER_COLOR, theme.PRIMARY_COLOR);
    const fill = contrast(theme.TAG_BG_COLOR, theme.PRIMARY_COLOR);
    expect(Math.max(edge, fill)).toBeGreaterThanOrEqual(VISIBLE_FLOOR);
  });
});
