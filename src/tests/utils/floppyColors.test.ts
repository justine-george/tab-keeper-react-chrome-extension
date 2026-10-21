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

// KAN-627. The welcome's floppy is a dark disk with a light shutter and label in every theme.
// Drawn in the text colour, it turned inside out in the dark themes.

const LIGHT = {
  Paper: LIGHT_THEME,
  Chalk: CHALK_THEME,
  'Warm light': WARM_LIGHT_THEME,
  'BB pink': BB_PINK_THEME,
};
const DARK = {
  Graphite: DARKENHEIMER_THEME,
  Blue: BLUE_THEME,
  Charcoal: CHARCOAL_THEME,
};
// KAN-731. Charcoal's disk is black, the darkest possible, on a header band that is 1.37:1 from it.
const DISK_FLOOR: Record<string, number> = { Charcoal: 1.35 };
const ALL = Object.entries({ ...LIGHT, ...DARK });

describe('the hero floppy in every theme (KAN-627)', () => {
  test.each(ALL)(
    '%s: a dark disk, with a lighter shutter and label',
    (_name, c) => {
      expect(luminance(c.FLOPPY_BODY_COLOR)).toBeLessThan(
        luminance(c.FLOPPY_PART_COLOR)
      );
    }
  );

  test.each(ALL)(
    '%s: the disk stands apart from the hero ground',
    (name, c) => {
      expect(
        contrast(c.FLOPPY_BODY_COLOR, c.SECONDARY_COLOR)
      ).toBeGreaterThanOrEqual(DISK_FLOOR[name] ?? 1.4);
    }
  );

  test.each(Object.entries(LIGHT))('%s keeps today’s floppy', (_name, c) => {
    expect(c.FLOPPY_BODY_COLOR).toBe(c.TEXT_COLOR);
    expect(c.FLOPPY_PART_COLOR).toBe(c.PRIMARY_COLOR);
  });

  test.each(Object.entries(DARK))(
    '%s: the disk is darker than the dialog it sits on',
    (_name, c) => {
      expect(luminance(c.FLOPPY_BODY_COLOR)).toBeLessThan(
        luminance(c.PRIMARY_COLOR)
      );
      expect(c.FLOPPY_PART_COLOR).toBe(c.TEXT_COLOR);
    }
  );
});
