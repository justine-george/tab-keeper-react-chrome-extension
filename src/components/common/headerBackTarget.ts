import { ICON } from '../../styles/scale';

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
