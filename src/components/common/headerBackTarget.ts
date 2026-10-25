import type { ThemeColors } from '../../hooks/useThemeColors';
import { DURATION, ICON } from '../../styles/scale';

/**
 * The hit area of a header "Back" control (KAN-240).
 *
 * ClickableRow resets its <button> to padding: 0, so a Back control was
 * exactly its content -- a 32px glyph and a label, 81x32 -- inside a 56px
 * header row with nothing beside it. A click a few pixels off the label did
 * nothing, and with no hover fill there was nothing to say where it ended.
 *
 * Padding grown and margin shrunk by the same amounts, so the glyph and the
 * label stay where they are and the row does not grow: 12px vertical, which
 * is the row's own padding, so the target is the row's full height; 8px left,
 * into the pane's padding no other control owns (the KAN-231 move); 16px
 * right, past the label. e2e/back-target.spec pins both the reach and that
 * nothing moved.
 *
 * A plain string, not css``: it is spliced into ClickableRow's `style` prop.
 */
export const HEADER_BACK_TARGET = `
  padding: 12px 16px 12px 8px;
  margin: -12px -16px -12px -8px;
`;

// KAN-517. Between the Back glyph's box and its label: a 12px ink gap (Justine's pick).
export const BACK_LABEL_GAP = '3px';

// The Back label's left edge from the control's content edge: a default Icon's box (its glyph and 4px a side), then the gap. Settings' category labels start here too.
export const BACK_LABEL_INSET = `calc(${ICON.DEFAULT} + 8px + ${BACK_LABEL_GAP})`;

// KAN-773 (Justine's pick B, mock round 4). The glyph rests this far right of its box's place, and its hover slide brings it back there, so the hover lands on the KAN-517 spacing. The label stays put.
export const BACK_GLYPH_SHIFT_PX = 2;

/**
 * The hover fill (KAN-773, Justine's pick from two mock rounds): the icon
 * buttons' hover and press greys, drawn 8px inside the target above. Its left
 * edge is the glyph box's, in line with Settings' category tiles, and it stays
 * off the page's top and left edges, which the target itself reaches.
 */
export const headerBackFillCss = (COLORS: ThemeColors) => `
  position: relative;
  isolation: isolate;
  &::before {
    content: '';
    position: absolute;
    inset: 8px;
    z-index: -1;
    transition: background-color ${DURATION.COLOR};
  }
  &:hover::before {
    background-color: ${COLORS.ICON_HOVER_COLOR};
  }
  &:active::before {
    background-color: ${COLORS.ICON_ACTIVE_COLOR};
  }
`;
