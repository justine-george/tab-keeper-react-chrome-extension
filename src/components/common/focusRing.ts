import type { ThemeColors } from '../../hooks/useThemeColors';

// The app's keyboard focus ring (KAN-405 1A): 2px of TEXT_COLOR, 4px inside
// the control. ≥4.86:1 on the page, hover and pressed fills in every theme.
// `on` is the rule it draws under; a field's row passes its own (KAN-671).
export const focusRingCss = (
  COLORS: ThemeColors,
  on = '&:focus-visible'
): string => `
  ${on} {
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
  ${on} {
    outline: 2px solid ${COLORS.PRIMARY_COLOR};
    outline-offset: -4px;
  }
`;

// KAN-671. The same ring 2px outside, for a control with no box to draw it
// in: a link in running text, a theme tile.
export const focusRingOutsideCss = (COLORS: ThemeColors): string => `
  &:focus-visible {
    outline: 2px solid ${COLORS.TEXT_COLOR};
    outline-offset: 2px;
  }
`;

// KAN-671. The same ring as a ::after of a positioned box, so it paints over
// the box's positioned children: a saved session's actions strip is opaque
// and would cover an outline's right edge.
export const focusRingAboveCss = (COLORS: ThemeColors, on: string): string => `
  ${on}::after {
    content: '';
    position: absolute;
    inset: 2px;
    border: 2px solid ${COLORS.TEXT_COLOR};
    pointer-events: none;
  }
`;
