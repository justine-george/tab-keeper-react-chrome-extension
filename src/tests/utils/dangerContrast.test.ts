import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  CHALK_THEME,
  CHARCOAL_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast, luminance } from '../setup/contrast';

// KAN-725. One red family for every destructive control. The hex values are
// Justine's picks, pinned here; everything else is a relation, so a restyle
// that keeps the reds readable and distinct still passes.

const THEMES = {
  LIGHT: LIGHT_THEME,
  CHALK: CHALK_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
  CHARCOAL: CHARCOAL_THEME,
};

const LIGHT_GROUP = ['LIGHT', 'WARM_LIGHT', 'BB_PINK', 'CHALK'];

/** WCAG 1.4.3 for normal-size text. */
const TEXT_FLOOR = 4.5;
/** WCAG 1.4.11 for a glyph, ring or meter mark. */
const GRAPHIC_FLOOR = 3;
/** The floor dividerContrast.test.ts uses for "can still be seen". */
const VISIBLE_STEP = 1.2;

describe('destructive tokens (KAN-725)', () => {
  test.each(Object.entries(THEMES))('%s: the picked values', (name, theme) => {
    const isLight = LIGHT_GROUP.includes(name);
    expect(theme.DANGER_INK).toBe(isLight ? '#A3211A' : '#FF9C94');
    expect(theme.DANGER_MARK).toBe(isLight ? '#C62828' : '#FF9C94');
    expect(theme.DANGER_FILL).toBe('#C62828');
    expect(theme.DANGER_FILL_DEEP).toBe('#B02020');
    expect(theme.DANGER_FILL_DEEPER).toBe('#951B1B');
    expect(theme.ON_DANGER_FILL).toBe('#FFFFFF');
  });

  test.each(Object.entries(THEMES))(
    '%s: red ink reads on the page, the panel and a hovered row',
    (_name, theme) => {
      for (const ground of [
        theme.PRIMARY_COLOR,
        theme.SECONDARY_COLOR,
        theme.HOVER_COLOR,
      ]) {
        expect(contrast(theme.DANGER_INK, ground)).toBeGreaterThanOrEqual(
          TEXT_FLOOR
        );
      }
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: white reads on every red rung',
    (_name, theme) => {
      for (const fill of [
        theme.DANGER_FILL,
        theme.DANGER_FILL_DEEP,
        theme.DANGER_FILL_DEEPER,
      ]) {
        expect(contrast(theme.ON_DANGER_FILL, fill)).toBeGreaterThanOrEqual(
          TEXT_FLOOR
        );
      }
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: each rung is a visible step deeper',
    (_name, theme) => {
      expect(
        contrast(theme.DANGER_FILL, theme.DANGER_FILL_DEEP)
      ).toBeGreaterThanOrEqual(VISIBLE_STEP);
      expect(
        contrast(theme.DANGER_FILL_DEEP, theme.DANGER_FILL_DEEPER)
      ).toBeGreaterThanOrEqual(VISIBLE_STEP);
      expect(luminance(theme.DANGER_FILL_DEEP)).toBeLessThan(
        luminance(theme.DANGER_FILL)
      );
      expect(luminance(theme.DANGER_FILL_DEEPER)).toBeLessThan(
        luminance(theme.DANGER_FILL_DEEP)
      );
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: the meter mark shows on its track and the page',
    (_name, theme) => {
      expect(
        contrast(theme.DANGER_MARK, theme.DIVIDER_COLOR)
      ).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
      expect(
        contrast(theme.DANGER_MARK, theme.PRIMARY_COLOR)
      ).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: a red hover reads unlike an ordinary one',
    (_name, theme) => {
      expect(
        contrast(theme.DANGER_FILL, theme.HOVER_COLOR)
      ).toBeGreaterThanOrEqual(VISIBLE_STEP);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: the old delete token is gone',
    (_name, theme) => {
      // Spelled in parts so the repo-wide grep for the old name stays empty.
      expect(theme).not.toHaveProperty(
        ['DELETE_ICON', 'HOVER_COLOR'].join('_')
      );
    }
  );

  test('CONTROL: the theme text colour would not read on the red', () => {
    expect(
      Object.values(THEMES).some(
        (t) => contrast(t.TEXT_COLOR, t.DANGER_FILL) < TEXT_FLOOR
      )
    ).toBe(true);
  });
});
