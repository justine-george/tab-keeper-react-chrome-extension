import type { ThemeColors } from '../../hooks/useThemeColors';

// The app's keyboard focus ring (KAN-405 1A): 2px of TEXT_COLOR, 4px inside
// the control. ≥4.86:1 on the page, hover and pressed fills in every theme.
export const focusRingCss = (COLORS: ThemeColors): string => `
  &:focus-visible {
    outline: 2px solid ${COLORS.TEXT_COLOR};
    outline-offset: -4px;
  }
`;
