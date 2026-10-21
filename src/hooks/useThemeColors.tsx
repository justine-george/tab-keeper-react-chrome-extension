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

export function useThemeColors() {
  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );
  // Both hooks run on every render, so the order never changes.
  const override = React.useContext(ThemeColorsOverride);
  if (override) return override;

  if (settingsData.theme === Theme.LIGHT) {
    return LIGHT_THEME;
  } else if (settingsData.theme === Theme.BLUE) {
    return BLUE_THEME;
  } else if (settingsData.theme === Theme.BB_PINK) {
    return BB_PINK_THEME;
  } else if (settingsData.theme === Theme.DARKENHEIMER) {
    return DARKENHEIMER_THEME;
  } else if (settingsData.theme === Theme.WARM_LIGHT) {
    return WARM_LIGHT_THEME;
  } else if (settingsData.theme === Theme.CHALK) {
    return CHALK_THEME;
  } else if (settingsData.theme === Theme.CHARCOAL) {
    return CHARCOAL_THEME;
  }

  // KAN-731. A theme this build does not know reads as the default.
  return defaultTheme() === Theme.CHARCOAL ? CHARCOAL_THEME : CHALK_THEME;
}
