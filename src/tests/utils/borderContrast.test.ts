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
// In the light themes a control's edge is held to WCAG 1.4.11's 3:1 on both
// grounds a control sits on. The dark themes sit below it on purpose: a light
// line on a dark ground reads heavier than its ratio, and at 3:1 the edges
// looked too strong, so Justine picked 2.77:1 on the page (2.44 on the raised
// fill). A panel's frame stays visible and under its theme's control edge, so
// a frame never reads as something to press. Relations, not hex values.

// Each theme with the floor its control edge is held to, on PRIMARY and SECONDARY.
const THEMES = {
  LIGHT: { theme: LIGHT_THEME, floor: [3, 3] },
  WARM_LIGHT: { theme: WARM_LIGHT_THEME, floor: [3, 3] },
  BB_PINK: { theme: BB_PINK_THEME, floor: [3, 3] },
  DARKENHEIMER: { theme: DARKENHEIMER_THEME, floor: [2.75, 2.4] },
  BLUE: { theme: BLUE_THEME, floor: [2.75, 2.4] },
};

// dividerContrast.test.ts: below this a 1px line effectively disappears.
const VISIBLE_FLOOR = 1.2;

describe('a control edge can be seen, a panel frame stays quiet', () => {
  test.each(Object.entries(THEMES))(
    '%s: the control edge clears its floor on the page and the raised fill',
    (_name, { theme, floor }) => {
      const grounds = [theme.PRIMARY_COLOR, theme.SECONDARY_COLOR];
      grounds.forEach((ground, i) => {
        const ratio = contrast(theme.CONTROL_BORDER_COLOR, ground);
        expect(
          ratio,
          `control edge ${theme.CONTROL_BORDER_COLOR} is ${ratio.toFixed(2)}:1 on ${ground}`
        ).toBeGreaterThanOrEqual(floor[i]);
      });
    }
  );

  test.each(Object.entries(THEMES))(
    '%s: the panel frame is visible on the page, and below its control edge',
    (_name, { theme, floor }) => {
      const ratio = contrast(theme.PANEL_BORDER_COLOR, theme.PRIMARY_COLOR);
      const message = `panel frame ${theme.PANEL_BORDER_COLOR} is ${ratio.toFixed(2)}:1 on ${theme.PRIMARY_COLOR}`;
      expect(ratio, message).toBeGreaterThanOrEqual(VISIBLE_FLOOR);
      expect(ratio, message).toBeLessThan(floor[0]);
    }
  );
});
