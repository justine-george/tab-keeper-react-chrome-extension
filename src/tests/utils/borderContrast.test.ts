import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-668. Two edges: a panel's frame and a control's. Light drew both in one
// near-black token, 7.54:1 against the page, so every pane, dialog and card
// was outlined like a button; the other four themes drew both at 1.38-1.75:1,
// so every button and text box was outlined like a pane.
//
// A control's edge is held to WCAG 1.4.11's 3:1 on both grounds a control
// sits on. A panel's frame stays visible and below that, so a frame never
// reads as something to press. Relations, not hex values.

const THEMES = {
  LIGHT: LIGHT_THEME,
  WARM_LIGHT: WARM_LIGHT_THEME,
  BB_PINK: BB_PINK_THEME,
  DARKENHEIMER: DARKENHEIMER_THEME,
  BLUE: BLUE_THEME,
};

// WCAG 1.4.11: a component's boundary against what is next to it.
const CONTROL_FLOOR = 3;
// dividerContrast.test.ts: below this a 1px line effectively disappears.
const VISIBLE_FLOOR = 1.2;

describe('a control edge can be seen, a panel frame stays quiet', () => {
  test.each(Object.entries(THEMES))(
    '%s: the control edge is at least 3:1 on the page and the raised fill',
    (_name, theme) => {
      for (const ground of [theme.PRIMARY_COLOR, theme.SECONDARY_COLOR]) {
        const ratio = contrast(theme.CONTROL_BORDER_COLOR, ground);
        expect(
          ratio,
          `control edge ${theme.CONTROL_BORDER_COLOR} is ${ratio.toFixed(2)}:1 on ${ground}`
        ).toBeGreaterThanOrEqual(CONTROL_FLOOR);
      }
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: the panel frame is visible on the page, and below a control edge',
    (_name, theme) => {
      const ratio = contrast(theme.PANEL_BORDER_COLOR, theme.PRIMARY_COLOR);
      const message = `panel frame ${theme.PANEL_BORDER_COLOR} is ${ratio.toFixed(2)}:1 on ${theme.PRIMARY_COLOR}`;
      expect(ratio, message).toBeGreaterThanOrEqual(VISIBLE_FLOOR);
      expect(ratio, message).toBeLessThan(CONTROL_FLOOR);
    }
  );
});
