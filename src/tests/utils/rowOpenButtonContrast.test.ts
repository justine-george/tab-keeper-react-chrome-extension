import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-394 D11 (pick 4B). The row's Open button is transparent over the strip
// mask (HOVER_COLOR) at rest, then fills with ICON_HOVER_COLOR on hover and
// ICON_ACTIVE_COLOR on press. LABEL_L1 is under 4.5:1 on the press fill in all
// five themes, so the label steps up to TEXT on hover and press.
const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};

const FLOOR = 4.5;

describe('the row Open button label is legible in every state', () => {
  test.each(Object.entries(THEMES))(
    '%s: LABEL_L1 on the strip mask at rest',
    (_name, t) => {
      const ratio = contrast(t.LABEL_L1_COLOR, t.HOVER_COLOR);
      expect(ratio, ratio.toFixed(2)).toBeGreaterThanOrEqual(FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: TEXT on the hover fill',
    (_name, t) => {
      const ratio = contrast(t.TEXT_COLOR, t.ICON_HOVER_COLOR);
      expect(ratio, ratio.toFixed(2)).toBeGreaterThanOrEqual(FLOOR);
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: TEXT on the press fill',
    (_name, t) => {
      const ratio = contrast(t.TEXT_COLOR, t.ICON_ACTIVE_COLOR);
      expect(ratio, ratio.toFixed(2)).toBeGreaterThanOrEqual(FLOOR);
    }
  );

  // CONTROL: the reason for the step-up. LABEL_L1 alone fails somewhere on
  // hover or press, so the test above is not vacuous.
  test('CONTROL: LABEL_L1 alone would fail on press in some theme', () => {
    const failing = Object.values(THEMES).filter(
      (t) => contrast(t.LABEL_L1_COLOR, t.ICON_ACTIVE_COLOR) < FLOOR
    );
    expect(failing.length).toBeGreaterThan(0);
  });
});
