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

// KAN-375. WCAG AA for small text.
const TEXT_FLOOR = 4.5;

const ALL: [string, ThemeColors][] = [
  ['LIGHT', LIGHT_THEME],
  ['CHALK', CHALK_THEME],
  ['WARM_LIGHT', WARM_LIGHT_THEME],
  ['BB_PINK', BB_PINK_THEME],
  ['DARKENHEIMER', DARKENHEIMER_THEME],
  ['BLUE', BLUE_THEME],
  ['CHARCOAL', CHARCOAL_THEME],
];

type ColorToken = Extract<keyof ThemeColors, `${string}_COLOR`>;

const on = (theme: ThemeColors, text: ColorToken, ground: ColorToken) =>
  contrast(theme[text], theme[ground]);

// LABEL_L1 on the page is held in syncStatus.test.tsx.
describe('text reads at 4.5:1 on the page', () => {
  test.each(ALL)('%s: body text', (_name, theme) => {
    expect(on(theme, 'TEXT_COLOR', 'PRIMARY_COLOR')).toBeGreaterThanOrEqual(
      TEXT_FLOOR
    );
  });
});

// KAN-672. Dates and counts sit on the page, the header fill (SECONDARY) and a
// hovered row or window header (KAN-395).
describe.each(['PRIMARY_COLOR', 'SECONDARY_COLOR', 'HOVER_COLOR'] as const)(
  'LABEL_L2 reads at 4.5:1 on %s',
  (ground) => {
    test.each(ALL)('%s', (_name, theme) => {
      expect(on(theme, 'LABEL_L2_COLOR', ground)).toBeGreaterThanOrEqual(
        TEXT_FLOOR
      );
    });
  }
);

// KAN-672. The selected row draws its date in LABEL_L1: L2 cannot reach 4.5 on
// SELECTION without becoming L1's twin.
describe('LABEL_L1 reads at 4.5:1 on the selection fill', () => {
  test.each(ALL)('%s', (_name, theme) => {
    expect(
      on(theme, 'LABEL_L1_COLOR', 'SELECTION_COLOR')
    ).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });
});

// KAN-672. The two grey tiers stay apart: dark themes sit at 1.28, light 1.52.
const TIER_GAP = 1.25;

describe('LABEL_L2 stays a step quieter than LABEL_L1', () => {
  test.each(ALL)('%s', (_name, theme) => {
    expect(
      on(theme, 'LABEL_L2_COLOR', 'LABEL_L1_COLOR')
    ).toBeGreaterThanOrEqual(TIER_GAP);
  });
});
