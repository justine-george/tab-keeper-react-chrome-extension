import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from '../redux/store';
import { Theme, defaultTheme } from '../utils/constants/theme';
import * as palettes from '../utils/constants/themePalettes';

// KAN-731. Re-exported as plain consts so importers keep reading them here; react-refresh reads an export-from as a component.
export const LIGHT_THEME = palettes.LIGHT_THEME;
export const WARM_LIGHT_THEME = palettes.WARM_LIGHT_THEME;
export const BB_PINK_THEME = palettes.BB_PINK_THEME;
export const DARKENHEIMER_THEME = palettes.DARKENHEIMER_THEME;
export const BLUE_THEME = palettes.BLUE_THEME;
export const CHALK_THEME = palettes.CHALK_THEME;
export const CHARCOAL_THEME = palettes.CHARCOAL_THEME;
export type ThemeColors = palettes.ThemeColors;

/**
 * Colours for one subtree that are not the extension theme's (KAN-198).
 *
 * The export page is light or dark on its own terms, and the shared components
 * it renders (Button, Icon, Toast) read their colours through useThemeColors.
 * This is how the page hands them its own colours without ever writing the
 * theme. Unset -- the popup, and everything else -- the hook follows the theme
 * exactly as before.
 */
export const ThemeColorsOverride = React.createContext<ThemeColors | null>(
  null
);

/** Graphite, Ink and Charcoal are the dark themes; the other four are light. */
export function isDarkTheme(theme: Theme): boolean {
  return (
    theme === Theme.DARKENHEIMER ||
    theme === Theme.BLUE ||
    theme === Theme.CHARCOAL
  );
}

// KAN-731. Every theme's table; a Record so a new theme without one fails to compile.
const THEME_COLORS: Record<Theme, ThemeColors> = {
  [Theme.LIGHT]: LIGHT_THEME,
  [Theme.WARM_LIGHT]: WARM_LIGHT_THEME,
  [Theme.BB_PINK]: BB_PINK_THEME,
  [Theme.DARKENHEIMER]: DARKENHEIMER_THEME,
  [Theme.BLUE]: BLUE_THEME,
  [Theme.CHALK]: CHALK_THEME,
  [Theme.CHARCOAL]: CHARCOAL_THEME,
};

export function useThemeColors() {
  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );
  // Both hooks run on every render, so the order never changes.
  const override = React.useContext(ThemeColorsOverride);
  if (override) return override;

  const colors: ThemeColors | undefined = THEME_COLORS[settingsData.theme];
  if (colors) return colors;

  // KAN-731. A theme this build does not know reads as the default.
  return THEME_COLORS[defaultTheme()];
}
