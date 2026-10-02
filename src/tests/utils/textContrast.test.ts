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
// Where Graphite and Ink sit today (4.32, 4.31): they may not fall further.
const KNOWN_FLOOR = 4.3;

const ALL: [string, ThemeColors][] = [
  ['LIGHT', LIGHT_THEME],
  ['WARM_LIGHT', WARM_LIGHT_THEME],
  ['BB_PINK', BB_PINK_THEME],
  ['DARKENHEIMER', DARKENHEIMER_THEME],
  ['BLUE', BLUE_THEME],
];

// Below the floor until their own palette pass (KAN-375).
const L2_BELOW = ['DARKENHEIMER', 'BLUE'];
const L2_OK = ALL.filter(([name]) => !L2_BELOW.includes(name));
const L2_KNOWN = ALL.filter(([name]) => L2_BELOW.includes(name));

type ColorToken = Extract<keyof ThemeColors, `${string}_COLOR`>;

const onPage = (theme: ThemeColors, token: ColorToken) =>
  contrast(theme[token], theme.PRIMARY_COLOR);

// LABEL_L1 is held in syncStatus.test.tsx.
describe('text reads at 4.5:1 on the page', () => {
  test.each(ALL)('%s: body text', (_name, theme) => {
    expect(onPage(theme, 'TEXT_COLOR')).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  test.each(L2_OK)('%s: LABEL_L2 on the page', (_name, theme) => {
    expect(onPage(theme, 'LABEL_L2_COLOR')).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  // Fails today on purpose; once it passes, remove the theme from L2_BELOW.
  test.fails.each(L2_KNOWN)(
    '%s: LABEL_L2 on the page, known below',
    (_name, theme) => {
      expect(onPage(theme, 'LABEL_L2_COLOR')).toBeGreaterThanOrEqual(
        TEXT_FLOOR
      );
    }
  );

  // test.fails passes on any failure, so it cannot catch a further drop.
  test.each(L2_KNOWN)(
    '%s: LABEL_L2 on the page, no lower than today',
    (_name, theme) => {
      expect(onPage(theme, 'LABEL_L2_COLOR')).toBeGreaterThanOrEqual(
        KNOWN_FLOOR
      );
    }
  );
});
