import { css } from '@emotion/react';

import type { ThemeColors } from '../../hooks/useThemeColors';
import { DURATION } from '../../styles/scale';

/**
 * The buttons a confirm dialog offers (KAN-259), shared by the three dialogs
 * that draw bordered buttons: FocusConfirm, DeleteCloudData, CloudConsent.
 *
 * Each had its own copy of one style with a hover rung and no press rung, so
 * a press looked exactly like a hover -- the defect KAN-236 fixed on the
 * settings rows and KAN-205 on Button. The rungs here are Button's own
 * (ICON_HOVER, then ICON_ACTIVE one past it), so a dialog button answers the
 * pointer the way every other button in the popup does. `danger` holds its
 * red on hover and press, as every destructive control does (KAN-204).
 */
export function dialogButtonStyles(COLORS: ThemeColors) {
  const base = css`
    padding: 8px 16px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    color: ${COLORS.TEXT_COLOR};
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    transition: background-color ${DURATION.COLOR};
    &:focus-visible {
      outline: 2px solid ${COLORS.TEXT_COLOR};
      outline-offset: -4px;
    }
  `;

  return {
    quiet: css`
      ${base}
      background-color: transparent;
      &:hover {
        background-color: ${COLORS.ICON_HOVER_COLOR};
      }
      &:active {
        background-color: ${COLORS.ICON_ACTIVE_COLOR};
      }
    `,
    primary: css`
      ${base}
      background-color: ${COLORS.SELECTION_COLOR};
      &:hover {
        background-color: ${COLORS.ICON_HOVER_COLOR};
      }
      &:active {
        background-color: ${COLORS.ICON_ACTIVE_COLOR};
      }
    `,
    danger: css`
      ${base}
      background-color: ${COLORS.DELETE_ICON_HOVER_COLOR};
      &:hover {
        background-color: ${COLORS.DELETE_ICON_HOVER_COLOR};
      }
      &:active {
        background-color: ${COLORS.DELETE_ICON_HOVER_COLOR};
      }
    `,
  };
}
