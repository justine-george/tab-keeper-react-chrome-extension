import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-375. WCAG AA for small text, on the page every row is drawn on.
const TEXT_FLOOR = 4.5;

const ALL: [string, ThemeColors][] = [
  ['LIGHT', LIGHT_THEME],
  ['WARM_LIGHT', WARM_LIGHT_THEME],
  ['BB_PINK', BB_PINK_THEME],
  ['DARKENHEIMER', DARKENHEIMER_THEME],
  ['BLUE', BLUE_THEME],
];

// Below the floor until their own palette pass (KAN-375): 4.32 and 4.31.
const L2_BELOW = ['DARKENHEIMER', 'BLUE'];
const L2_OK = ALL.filter(([name]) => !L2_BELOW.includes(name));
const L2_KNOWN = ALL.filter(([name]) => L2_BELOW.includes(name));

const onPage = (theme: ThemeColors, token: keyof ThemeColors) =>
  contrast(theme[token], theme.PRIMARY_COLOR);

describe('text reads at 4.5:1 on the page', () => {
  test.each(ALL)('%s: body text and LABEL_L1', (_name, theme) => {
    expect(onPage(theme, 'TEXT_COLOR')).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(onPage(theme, 'LABEL_L1_COLOR')).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  test.each(L2_OK)('%s: LABEL_L2 (dates, group titles)', (_name, theme) => {
    expect(onPage(theme, 'LABEL_L2_COLOR')).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  // Fails today on purpose; once it passes, move the theme into L2_OK.
  test.fails.each(L2_KNOWN)('%s: LABEL_L2, known below', (_name, theme) => {
    expect(onPage(theme, 'LABEL_L2_COLOR')).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });
});
