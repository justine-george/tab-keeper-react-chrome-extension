import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from '../redux/store';
import { Theme, defaultTheme } from '../utils/constants/theme';

// KAN-267. What a floating surface (the overflow menu) casts on this ground:
// a tight contact edge plus a soft lift. Black at 18% can only take 18% off a
// ground that is already at 42/255, so the dark themes carry a much heavier
// one -- the same shadow measured Δ50 below the menu's edge on Paper and Δ8
// on Graphite. Per theme rather than one rule for that reason.
export const LIGHT_THEME = {
  PRIMARY_COLOR: '#F5F7FA',
  SECONDARY_COLOR: '#E9ECF0',
  SELECTION_COLOR: '#CBCED3',
  PRIMARY_LIGHT: '#FCFDFE',
  POSITIVE_COLOR: '#92E097',
  HOVER_COLOR: '#E4E7EB',
  ACTIVE_COLOR: '#CAD0D8',
  CHIP_COLOR: '#D5D8DC',
  ICON_HOVER_COLOR: '#C2C4C7',
  ICON_ACTIVE_COLOR: '#B3B6B9',
  // KAN-725. The destructive family: ink for a red label or icon on the page or a menu.
  DANGER_INK: '#A3211A',
  // KAN-725. Solid red: hover on a quiet destructive control, a dialog confirm at rest.
  DANGER_FILL: '#C62828',
  // KAN-725. One step deeper: press on a quiet destructive control, a confirm on hover.
  DANGER_FILL_DEEP: '#B02020',
  // KAN-725. Two steps deeper: a dialog confirm on press.
  DANGER_FILL_DEEPER: '#951B1B',
  // KAN-725. Ink, glyph and focus ring on any red fill; TEXT_COLOR fails on it.
  ON_DANGER_FILL: '#FFFFFF',
  // KAN-725. A non-text red mark on the page ground: the sync meter.
  DANGER_MARK: '#C62828',
  LABEL_L3_COLOR: '#9A9C9F',
  LABEL_L1_COLOR: '#4A4C4F',
  // KAN-672. 4.5:1 on PRIMARY, SECONDARY and HOVER; on SELECTION use LABEL_L1.
  LABEL_L2_COLOR: '#66686B',
  PLACEHOLDER_COLOR: '#6E7073',
  TAG_BG_COLOR: '#F0F2F5',
  TAG_BORDER_COLOR: '#DCDEE1',
  // KAN-668. Two edges: a pane, dialog or card's frame stays quiet; anything
  // pressed or typed in gets an edge at 3:1 on PRIMARY and SECONDARY (WCAG
  // 1.4.11) here, and 2.77:1 in the dark themes, where 3:1 read too strong.
  // borderContrast.test.ts holds every theme to its floor.
  PANEL_BORDER_COLOR: '#BEC0C3',
  CONTROL_BORDER_COLOR: '#85878A',
  DIVIDER_COLOR: '#D8DADD',
  TEXT_COLOR: '#3B3D40',
  // KAN-627. The welcome's floppy: a dark disk with light parts in every theme.
  FLOPPY_BODY_COLOR: '#3B3D40',
  FLOPPY_PART_COLOR: '#F5F7FA',
  SCROLLBAR_TRACK: '#F5F7FA',
  SCROLLBAR_THUMB: '#8D8F92',
  SCROLLBAR_THUMB_HOVER: '#787A7D',
  SCROLLBAR_THUMB_ACTIVE: '#636568',
  FLOATING_SHADOW:
    '0 1px 2px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.18)',
  // KAN-421. The tour's dim outside the step's bright box; heavier on the dark grounds, as FLOATING_SHADOW is.
  TOUR_SCRIM: 'rgba(0, 0, 0, 0.2)',
  // KAN-588. Behind every dialog: heavier than the tour's dim, light enough to see the page.
  MODAL_BACKDROP: 'rgba(0, 0, 0, 0.4)',
};

export const WARM_LIGHT_THEME = {
  PRIMARY_COLOR: '#F8F3E8',
  SECONDARY_COLOR: '#EDE8D0',
  SELECTION_COLOR: '#E0DBBF',
  PRIMARY_LIGHT: '#FBF8EF',
  POSITIVE_COLOR: '#7EB37E',
  HOVER_COLOR: '#F2EDDD',
  ACTIVE_COLOR: '#DACC9E',
  CHIP_COLOR: '#D9D4BC',
  ICON_HOVER_COLOR: '#C6C1B7',
  ICON_ACTIVE_COLOR: '#B8B2A6',
  // KAN-725. The destructive family: ink for a red label or icon on the page or a menu.
  DANGER_INK: '#A3211A',
  // KAN-725. Solid red: hover on a quiet destructive control, a dialog confirm at rest.
  DANGER_FILL: '#C62828',
  // KAN-725. One step deeper: press on a quiet destructive control, a confirm on hover.
  DANGER_FILL_DEEP: '#B02020',
  // KAN-725. Two steps deeper: a dialog confirm on press.
  DANGER_FILL_DEEPER: '#951B1B',
  // KAN-725. Ink, glyph and focus ring on any red fill; TEXT_COLOR fails on it.
  ON_DANGER_FILL: '#FFFFFF',
  // KAN-725. A non-text red mark on the page ground: the sync meter.
  DANGER_MARK: '#C62828',
  LABEL_L3_COLOR: '#7B776F',
  LABEL_L1_COLOR: '#504D41',
  LABEL_L2_COLOR: '#6B685E',
  PLACEHOLDER_COLOR: '#6D6A60',
  // KAN-673. Paper and Petal's tag: fill 1.05:1, edge 1.26:1 on the page.
  TAG_BG_COLOR: '#F2EEDC',
  TAG_BORDER_COLOR: '#E0DBBE',
  PANEL_BORDER_COLOR: '#D6D2B0',
  CONTROL_BORDER_COLOR: '#89847C',
  DIVIDER_COLOR: '#DCD7CD',
  TEXT_COLOR: '#28251F',
  FLOPPY_BODY_COLOR: '#28251F',
  FLOPPY_PART_COLOR: '#F8F3E8',
  SCROLLBAR_TRACK: '#F8F3E8',
  SCROLLBAR_THUMB: '#918C84',
  SCROLLBAR_THUMB_HOVER: '#7B776F',
  SCROLLBAR_THUMB_ACTIVE: '#65625A',
  FLOATING_SHADOW:
    '0 1px 2px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.18)',
  TOUR_SCRIM: 'rgba(0, 0, 0, 0.2)',
  MODAL_BACKDROP: 'rgba(0, 0, 0, 0.4)',
};

export const BB_PINK_THEME = {
  PRIMARY_COLOR: '#FCEEF3',
  SECONDARY_COLOR: '#FADEE7',
  SELECTION_COLOR: '#E8BACA',
  PRIMARY_LIGHT: '#FFF2F7',
  POSITIVE_COLOR: '#C65E89',
  HOVER_COLOR: '#F3DCE3',
  ACTIVE_COLOR: '#ECBFCE',
  CHIP_COLOR: '#E4C9D2',
  ICON_HOVER_COLOR: '#D8AABA',
  ICON_ACTIVE_COLOR: '#CB9CAC',
  // KAN-725. The destructive family: ink for a red label or icon on the page or a menu.
  DANGER_INK: '#A3211A',
  // KAN-725. Solid red: hover on a quiet destructive control, a dialog confirm at rest.
  DANGER_FILL: '#C62828',
  // KAN-725. One step deeper: press on a quiet destructive control, a confirm on hover.
  DANGER_FILL_DEEP: '#B02020',
  // KAN-725. Two steps deeper: a dialog confirm on press.
  DANGER_FILL_DEEPER: '#951B1B',
  // KAN-725. Ink, glyph and focus ring on any red fill; TEXT_COLOR fails on it.
  ON_DANGER_FILL: '#FFFFFF',
  // KAN-725. A non-text red mark on the page ground: the sync meter.
  DANGER_MARK: '#C62828',
  LABEL_L3_COLOR: '#AB919A',
  LABEL_L1_COLOR: '#56454A',
  LABEL_L2_COLOR: '#775E67',
  PLACEHOLDER_COLOR: '#81656F',
  TAG_BG_COLOR: '#F7EAEE',
  TAG_BORDER_COLOR: '#E9D3DA',
  PANEL_BORDER_COLOR: '#D0B1BB',
  CONTROL_BORDER_COLOR: '#997A85',
  DIVIDER_COLOR: '#E5CFD6',
  TEXT_COLOR: '#43363B',
  FLOPPY_BODY_COLOR: '#43363B',
  FLOPPY_PART_COLOR: '#FCEEF3',
  SCROLLBAR_TRACK: '#FCEEF3',
  SCROLLBAR_THUMB: '#A1848D',
  SCROLLBAR_THUMB_HOVER: '#8D6E79',
  SCROLLBAR_THUMB_ACTIVE: '#795865',
  FLOATING_SHADOW:
    '0 1px 2px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.18)',
  TOUR_SCRIM: 'rgba(0, 0, 0, 0.2)',
  MODAL_BACKDROP: 'rgba(0, 0, 0, 0.4)',
};

export const DARKENHEIMER_THEME = {
  PRIMARY_COLOR: '#2A2A2A',
  SECONDARY_COLOR: '#333333',
  SELECTION_COLOR: '#3B3B3B',
  PRIMARY_LIGHT: '#444444',
  POSITIVE_COLOR: '#AF4C7E',
  HOVER_COLOR: '#2F2F2F',
  ACTIVE_COLOR: '#434343',
  CHIP_COLOR: '#404040',
  ICON_HOVER_COLOR: '#4A4A4A',
  ICON_ACTIVE_COLOR: '#545454',
  // KAN-725. The destructive family: ink for a red label or icon on the page or a menu.
  DANGER_INK: '#FF9C94',
  // KAN-725. Solid red: hover on a quiet destructive control, a dialog confirm at rest.
  DANGER_FILL: '#C62828',
  // KAN-725. One step deeper: press on a quiet destructive control, a confirm on hover.
  DANGER_FILL_DEEP: '#B02020',
  // KAN-725. Two steps deeper: a dialog confirm on press.
  DANGER_FILL_DEEPER: '#951B1B',
  // KAN-725. Ink, glyph and focus ring on any red fill; TEXT_COLOR fails on it.
  ON_DANGER_FILL: '#FFFFFF',
  // KAN-725. A non-text red mark on the page ground: the sync meter.
  DANGER_MARK: '#FF9C94',
  LABEL_L3_COLOR: '#6B6B6B',
  LABEL_L1_COLOR: '#B0B0B0',
  LABEL_L2_COLOR: '#9B9B9B',
  PLACEHOLDER_COLOR: '#919191',
  TAG_BG_COLOR: '#3E3E3E',
  TAG_BORDER_COLOR: '#2A2A2A',
  PANEL_BORDER_COLOR: '#444444',
  CONTROL_BORDER_COLOR: '#6D6D6D',
  DIVIDER_COLOR: '#3C3C3C',
  TEXT_COLOR: '#D0D0D0',
  FLOPPY_BODY_COLOR: '#131313',
  FLOPPY_PART_COLOR: '#D0D0D0',
  SCROLLBAR_TRACK: '#2A2A2A',
  SCROLLBAR_THUMB: '#737373',
  SCROLLBAR_THUMB_HOVER: '#878787',
  SCROLLBAR_THUMB_ACTIVE: '#9B9B9B',
  FLOATING_SHADOW:
    '0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.55)',
  TOUR_SCRIM: 'rgba(0, 0, 0, 0.4)',
  MODAL_BACKDROP: 'rgba(0, 0, 0, 0.55)',
};

export const BLUE_THEME = {
  PRIMARY_COLOR: '#2A2A3A',
  SECONDARY_COLOR: '#333340',
  SELECTION_COLOR: '#3B3B4A',
  PRIMARY_LIGHT: '#444454',
  POSITIVE_COLOR: '#4C7EAF',
  HOVER_COLOR: '#2F2F3E',
  ACTIVE_COLOR: '#424258',
  CHIP_COLOR: '#3F3F4C',
  ICON_HOVER_COLOR: '#4A4A58',
  ICON_ACTIVE_COLOR: '#545464',
  // KAN-725. The destructive family: ink for a red label or icon on the page or a menu.
  DANGER_INK: '#FF9C94',
  // KAN-725. Solid red: hover on a quiet destructive control, a dialog confirm at rest.
  DANGER_FILL: '#C62828',
  // KAN-725. One step deeper: press on a quiet destructive control, a confirm on hover.
  DANGER_FILL_DEEP: '#B02020',
  // KAN-725. Two steps deeper: a dialog confirm on press.
  DANGER_FILL_DEEPER: '#951B1B',
  // KAN-725. Ink, glyph and focus ring on any red fill; TEXT_COLOR fails on it.
  ON_DANGER_FILL: '#FFFFFF',
  // KAN-725. A non-text red mark on the page ground: the sync meter.
  DANGER_MARK: '#FF9C94',
  LABEL_L3_COLOR: '#6B6B7B',
  LABEL_L1_COLOR: '#B0B0BF',
  LABEL_L2_COLOR: '#9B9BAB',
  PLACEHOLDER_COLOR: '#9191A1',
  TAG_BG_COLOR: '#3E3E48',
  TAG_BORDER_COLOR: '#2A2A3A',
  PANEL_BORDER_COLOR: '#444454',
  CONTROL_BORDER_COLOR: '#6D6D7E',
  DIVIDER_COLOR: '#3C3C4B',
  TEXT_COLOR: '#D0D0DF',
  FLOPPY_BODY_COLOR: '#13131A',
  FLOPPY_PART_COLOR: '#D0D0DF',
  SCROLLBAR_TRACK: '#2A2A3A',
  SCROLLBAR_THUMB: '#737382',
  SCROLLBAR_THUMB_HOVER: '#888897',
  SCROLLBAR_THUMB_ACTIVE: '#9D9DAC',
  FLOATING_SHADOW:
    '0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.55)',
  TOUR_SCRIM: 'rgba(0, 0, 0, 0.4)',
  MODAL_BACKDROP: 'rgba(0, 0, 0, 0.55)',
};

export const CHALK_THEME = {
  // KAN-731. Chalk: a white page on the Atlassian neutral ramp, higher contrast than Paper.
  PRIMARY_COLOR: '#FFFFFF',
  SECONDARY_COLOR: '#F3F5F7',
  SELECTION_COLOR: '#D1D2D6',
  PRIMARY_LIGHT: '#FFFFFF',
  POSITIVE_COLOR: '#92E097',
  HOVER_COLOR: '#EDEEF0',
  ACTIVE_COLOR: '#D5D6DA',
  CHIP_COLOR: '#DEDFE2',
  ICON_HOVER_COLOR: '#C6C8CC',
  ICON_ACTIVE_COLOR: '#B7B9BE',
  DANGER_INK: '#A3211A',
  DANGER_FILL: '#C62828',
  DANGER_FILL_DEEP: '#B02020',
  DANGER_FILL_DEEPER: '#951B1B',
  ON_DANGER_FILL: '#FFFFFF',
  DANGER_MARK: '#C62828',
  LABEL_L3_COLOR: '#7E8189',
  LABEL_L1_COLOR: '#292A2E',
  LABEL_L2_COLOR: '#505258',
  PLACEHOLDER_COLOR: '#6C6E75',
  TAG_BG_COLOR: '#F0F1F2',
  TAG_BORDER_COLOR: '#DDDEE1',
  // KAN-731. Quiet frame at the divider's weight, 1.40:1 on a hovered row.
  PANEL_BORDER_COLOR: '#D8DADD',
  // KAN-731. Softer pick: 2.41:1 on the page, under 3:1. borderContrast.test.ts gives Chalk its own floor.
  CONTROL_BORDER_COLOR: '#A5A7AD',
  DIVIDER_COLOR: '#DDDEE1',
  TEXT_COLOR: '#1E1F21',
  FLOPPY_BODY_COLOR: '#1E1F21',
  FLOPPY_PART_COLOR: '#FFFFFF',
  SCROLLBAR_TRACK: '#FFFFFF',
  SCROLLBAR_THUMB: '#8D8F96',
  SCROLLBAR_THUMB_HOVER: '#6C6E75',
  SCROLLBAR_THUMB_ACTIVE: '#505258',
  FLOATING_SHADOW:
    '0 1px 2px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.18)',
  TOUR_SCRIM: 'rgba(0, 0, 0, 0.2)',
  MODAL_BACKDROP: 'rgba(0, 0, 0, 0.4)',
};

export const CHARCOAL_THEME = {
  // KAN-731. Charcoal: a near-black page on the Atlassian neutral ramp, higher contrast than Graphite.
  PRIMARY_COLOR: '#18191A',
  SECONDARY_COLOR: '#242528',
  SELECTION_COLOR: '#2C2E30',
  PRIMARY_LIGHT: '#3D3F43',
  POSITIVE_COLOR: '#AF4C7E',
  HOVER_COLOR: '#1F2022',
  ACTIVE_COLOR: '#343639',
  CHIP_COLOR: '#313336',
  ICON_HOVER_COLOR: '#3C3D41',
  ICON_ACTIVE_COLOR: '#46484C',
  DANGER_INK: '#FF9C94',
  DANGER_FILL: '#C62828',
  DANGER_FILL_DEEP: '#B02020',
  DANGER_FILL_DEEPER: '#951B1B',
  ON_DANGER_FILL: '#FFFFFF',
  DANGER_MARK: '#FF9C94',
  LABEL_L3_COLOR: '#7F8187',
  LABEL_L1_COLOR: '#CECFD2',
  LABEL_L2_COLOR: '#A9ABB0',
  PLACEHOLDER_COLOR: '#97999E',
  TAG_BG_COLOR: '#303134',
  TAG_BORDER_COLOR: '#18191A',
  PANEL_BORDER_COLOR: '#313336',
  // KAN-731. Softer pick: 2.32:1 on the page, under the dark themes' 2.75. borderContrast.test.ts gives Charcoal its own floor.
  CONTROL_BORDER_COLOR: '#525458',
  DIVIDER_COLOR: '#303134',
  TEXT_COLOR: '#F0F1F2',
  // KAN-731. Black, the darkest possible: 1.37:1 on the header band. floppyColors.test.ts gives Charcoal its own floor.
  FLOPPY_BODY_COLOR: '#000000',
  FLOPPY_PART_COLOR: '#F0F1F2',
  SCROLLBAR_TRACK: '#18191A',
  SCROLLBAR_THUMB: '#64666B',
  SCROLLBAR_THUMB_HOVER: '#97999E',
  SCROLLBAR_THUMB_ACTIVE: '#B0B2B7',
  FLOATING_SHADOW:
    '0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.55)',
  TOUR_SCRIM: 'rgba(0, 0, 0, 0.4)',
  MODAL_BACKDROP: 'rgba(0, 0, 0, 0.55)',
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
