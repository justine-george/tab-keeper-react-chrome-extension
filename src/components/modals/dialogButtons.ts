import { css } from '@emotion/react';

import type { ThemeColors } from '../../hooks/useThemeColors';
import { CONTROL, DURATION } from '../../styles/scale';
import { focusRingCss, whileKeyNav } from '../common/focusRing';
import { mixHex } from '../../styles/mixHex';

// A dialog button's padding and border, which a flush link hangs outside.
const PAD = { BLOCK: 8, INLINE: 16 } as const;
const BORDER = 1;

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
    padding: ${PAD.BLOCK}px ${PAD.INLINE}px;
    border: ${BORDER}px solid ${COLORS.CONTROL_BORDER_COLOR};
    color: ${COLORS.TEXT_COLOR};
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    transition: background-color ${DURATION.COLOR};
    ${focusRingCss(COLORS)}
  `;

  const filledHover = mixHex(COLORS.TEXT_COLOR, COLORS.PRIMARY_COLOR, 0.88);
  const filledPress = mixHex(COLORS.TEXT_COLOR, COLORS.PRIMARY_COLOR, 0.76);

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
    // KAN-7. A dismissal that reads as text: no frame, the same rungs.
    link: css`
      ${base}
      border-color: transparent;
      background-color: transparent;
      text-decoration: underline;
      text-underline-offset: 3px;
      &:hover {
        background-color: ${COLORS.ICON_HOVER_COLOR};
      }
      &:active {
        background-color: ${COLORS.ICON_ACTIVE_COLOR};
      }
    `,
    // The run's way forward: TEXT_COLOR ground, PRIMARY_COLOR letters; rungs are a mix, never opacity.
    filled: css`
      ${base}
      transition:
        background-color ${DURATION.COLOR},
        border-color ${DURATION.COLOR};
      border-color: ${COLORS.TEXT_COLOR};
      background-color: ${COLORS.TEXT_COLOR};
      color: ${COLORS.PRIMARY_COLOR};
      &:hover {
        border-color: ${filledHover};
        background-color: ${filledHover};
      }
      &:active {
        border-color: ${filledPress};
        background-color: ${filledPress};
      }
      ${whileKeyNav('&:focus-visible')} {
        outline: 2px solid ${COLORS.TEXT_COLOR};
        outline-offset: 2px;
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

/**
 * KAN-654. The first run's buttons at the control height, as the review
 * card's Rate is. `inline` is the side padding: 24 on a dialog, 20 on the
 * narrower tour card.
 */
export const tallButtonCss = (inline: number) => css`
  height: ${CONTROL.DEFAULT};
  padding-block: 0;
  padding-inline: ${inline}px;
`;

/**
 * KAN-654. A secondary then its primary, the primary half as wide again.
 * The grid sizes from the longer label, so neither is cut off in any
 * language.
 */
export const pairCss = css`
  display: grid;
  grid-auto-flow: column;
  grid-template-columns: 1fr 1.5fr;
  gap: 8px;
  width: fit-content;
`;

// KAN-654. A link whose words start on the content edge: its padding and border hang outside it.
export const flushLinkCss = css`
  margin-inline-start: -${PAD.INLINE + BORDER}px;
`;
