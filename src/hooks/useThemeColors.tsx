import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from '../redux/store';
import { Theme } from '../redux/slices/settingsDataStateSlice';

export const LIGHT_THEME = {
  PRIMARY_COLOR: '#F5F7FA',
  SECONDARY_COLOR: '#E9ECF0',
  SELECTION_COLOR: '#CBCED3',
  PRIMARY_LIGHT: '#FCFDFE',
  POSITIVE_COLOR: '#92E097',
  HOVER_COLOR: '#E4E7EB',
  ACTIVE_COLOR: '#CAD0D8',
  ICON_HOVER_COLOR: '#C2C4C7',
  ICON_ACTIVE_COLOR: '#B3B6B9',
  DELETE_ICON_HOVER_COLOR: '#E09494',
  LABEL_L3_COLOR: '#9A9C9F',
  LABEL_L1_COLOR: '#4A4C4F',
  LABEL_L2_COLOR: '#6E7073',
  TAG_BG_COLOR: '#F0F2F5',
  TAG_BORDER_COLOR: '#DCDEE1',
  BORDER_COLOR: '#4E5053',
  DIVIDER_COLOR: '#D8DADD',
  TEXT_COLOR: '#3B3D40',
  SCROLLBAR_TRACK: '#F5F7FA',
  SCROLLBAR_THUMB: '#AFB1B4',
  SCROLLBAR_THUMB_HOVER: '#8D8F92',
  SCROLLBAR_THUMB_ACTIVE: '#787A7D',
};

export const WARM_LIGHT_THEME = {
  PRIMARY_COLOR: '#F8F3E8',
  SECONDARY_COLOR: '#EDE8D0',
  SELECTION_COLOR: '#E0DBBF',
  PRIMARY_LIGHT: '#FBF8EF',
  POSITIVE_COLOR: '#7EB37E',
  HOVER_COLOR: '#F2EDDD',
  ACTIVE_COLOR: '#DACC9E',
  ICON_HOVER_COLOR: '#C6C1B7',
  ICON_ACTIVE_COLOR: '#B8B2A6',
  DELETE_ICON_HOVER_COLOR: '#D56E6E',
  LABEL_L3_COLOR: '#7B776F',
  LABEL_L1_COLOR: '#504D41',
  LABEL_L2_COLOR: '#6D6A60',
  TAG_BG_COLOR: '#F5F2E4',
  TAG_BORDER_COLOR: '#E6E2CA',
  BORDER_COLOR: '#D6D2B0',
  DIVIDER_COLOR: '#DCD7CD',
  TEXT_COLOR: '#28251F',
  SCROLLBAR_TRACK: '#F8F3E8',
  SCROLLBAR_THUMB: '#B2AEA5',
  SCROLLBAR_THUMB_HOVER: '#918C84',
  SCROLLBAR_THUMB_ACTIVE: '#7B776F',
};

export const BB_PINK_THEME = {
  PRIMARY_COLOR: '#FAD2E1',
  SECONDARY_COLOR: '#F9BFD2',
  SELECTION_COLOR: '#F89CB9',
  PRIMARY_LIGHT: '#FCE4EC',
  POSITIVE_COLOR: '#F06292',
  HOVER_COLOR: '#F9BED2',
  ACTIVE_COLOR: '#F69FBC',
  ICON_HOVER_COLOR: '#F48FB1',
  ICON_ACTIVE_COLOR: '#F27AA3',
  DELETE_ICON_HOVER_COLOR: '#D77575',
  LABEL_L3_COLOR: '#BF4080',
  LABEL_L1_COLOR: '#2A2A2A',
  LABEL_L2_COLOR: '#D81B60',
  TAG_BG_COLOR: '#FCE4EC',
  TAG_BORDER_COLOR: '#F89CB9',
  BORDER_COLOR: '#F48FB1',
  DIVIDER_COLOR: '#F4AFC9',
  TEXT_COLOR: '#2A2A2A',
  SCROLLBAR_TRACK: '#FAD2E1',
  SCROLLBAR_THUMB: '#E978A2',
  SCROLLBAR_THUMB_HOVER: '#DF3F7A',
  SCROLLBAR_THUMB_ACTIVE: '#CA1C5C',
};

export const DARKENHEIMER_THEME = {
  PRIMARY_COLOR: '#2A2A2A',
  SECONDARY_COLOR: '#333333',
  SELECTION_COLOR: '#3B3B3B',
  PRIMARY_LIGHT: '#444444',
  POSITIVE_COLOR: '#AF4C7E',
  HOVER_COLOR: '#2F2F2F',
  ACTIVE_COLOR: '#434343',
  ICON_HOVER_COLOR: '#4A4A4A',
  ICON_ACTIVE_COLOR: '#545454',
  DELETE_ICON_HOVER_COLOR: '#8F4040',
  LABEL_L3_COLOR: '#6B6B6B',
  LABEL_L1_COLOR: '#B0B0B0',
  LABEL_L2_COLOR: '#8D8D8D',
  TAG_BG_COLOR: '#3E3E3E',
  TAG_BORDER_COLOR: '#2A2A2A',
  BORDER_COLOR: '#4E4E4E',
  DIVIDER_COLOR: '#3C3C3C',
  TEXT_COLOR: '#D0D0D0',
  SCROLLBAR_TRACK: '#2A2A2A',
  SCROLLBAR_THUMB: '#585858',
  SCROLLBAR_THUMB_HOVER: '#737373',
  SCROLLBAR_THUMB_ACTIVE: '#878787',
};

export const BLUE_THEME = {
  PRIMARY_COLOR: '#2A2A3A',
  SECONDARY_COLOR: '#333340',
  SELECTION_COLOR: '#3B3B4A',
  PRIMARY_LIGHT: '#444454',
  POSITIVE_COLOR: '#4C7EAF',
  HOVER_COLOR: '#2F2F3E',
  ACTIVE_COLOR: '#424258',
  ICON_HOVER_COLOR: '#4A4A58',
  ICON_ACTIVE_COLOR: '#545464',
  DELETE_ICON_HOVER_COLOR: '#8D405A',
  LABEL_L3_COLOR: '#6B6B7B',
  LABEL_L1_COLOR: '#B0B0BF',
  LABEL_L2_COLOR: '#8D8D9D',
  TAG_BG_COLOR: '#3E3E48',
  TAG_BORDER_COLOR: '#2A2A3A',
  BORDER_COLOR: '#4E4E5E',
  DIVIDER_COLOR: '#3C3C4B',
  TEXT_COLOR: '#D0D0DF',
  SCROLLBAR_TRACK: '#2A2A3A',
  SCROLLBAR_THUMB: '#585867',
  SCROLLBAR_THUMB_HOVER: '#737382',
  SCROLLBAR_THUMB_ACTIVE: '#888897',
};

/** The colour tokens every theme defines. */
export type ThemeColors = typeof LIGHT_THEME;

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

/** Darkenheimer and Blue are the dark themes; the other three are light. */
export function isDarkTheme(theme: Theme): boolean {
  return theme === Theme.DARKENHEIMER || theme === Theme.BLUE;
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
  }

  return LIGHT_THEME;
}
