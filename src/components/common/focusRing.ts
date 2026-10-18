import type { ThemeColors } from '../../hooks/useThemeColors';
import { KEY_NAV_ATTRIBUTE } from '../../utils/functions/keyNav';

// KAN-689. `on`, a nested selector, only while the user navigates by keyboard
// (keyNav.ts). Every :focus-visible rule in the app is written under it.
// html, not :root: Emotion reads a leading colon as the parent's own pseudo.
export const whileKeyNav = (on: string): string =>
  `html[${KEY_NAV_ATTRIBUTE}] ${on}`;

// The app's keyboard focus ring (KAN-405 1A): 2px of TEXT_COLOR, 4px inside
// the control. ≥4.86:1 on the page, hover and pressed fills in every theme.
// `on` is the rule it draws under; a field's row passes its own (KAN-671).
export const focusRingCss = (
  COLORS: ThemeColors,
  on = '&:focus-visible'
): string => `
  ${whileKeyNav(on)} {
    outline: 2px solid ${COLORS.TEXT_COLOR};
    outline-offset: -4px;
  }
`;

// KAN-671. The same ring on a ground of TEXT_COLOR, in PRIMARY_COLOR: a
// sliding pair's pressed half, under its knob.
export const focusRingOnTextGroundCss = (
  COLORS: ThemeColors,
  on: string
): string => `
  ${whileKeyNav(on)} {
    outline: 2px solid ${COLORS.PRIMARY_COLOR};
    outline-offset: -4px;
  }
`;

// KAN-671. The same ring 2px outside, for a control with no box to draw it
// in: a link in running text, a theme tile, a group title (KAN-685).
export const focusRingOutsideCss = (COLORS: ThemeColors): string => `
  ${whileKeyNav('&:focus-visible')} {
    outline: 2px solid ${COLORS.TEXT_COLOR};
    outline-offset: 2px;
  }
`;

// KAN-671. The same ring as a ::after of a positioned box, so it paints over
// the box's positioned children: a saved session's actions strip is opaque
// and would cover an outline's right edge.
export const focusRingAboveCss = (COLORS: ThemeColors, on: string): string => `
  ${whileKeyNav(on)}::after {
    content: '';
    position: absolute;
    inset: 2px;
    border: 2px solid ${COLORS.TEXT_COLOR};
    pointer-events: none;
  }
`;

// KAN-677. The same ring over a rename field, drawn by the box the field
// fills, which this makes positioned: its tick is laid on the field's right end, positioned, and fills
// under the pointer, which covers an outline. Above the tick strips
// (z-index 1), under a row with an open menu (3).
export const focusRingOverTickCss = (
  COLORS: ThemeColors,
  on: string
): string => `
  position: relative;
  ${whileKeyNav(on)}::after {
    content: '';
    position: absolute;
    inset: 2px;
    border: 2px solid ${COLORS.TEXT_COLOR};
    pointer-events: none;
    z-index: 2;
  }
`;
