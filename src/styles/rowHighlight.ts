import { CORNER_SHAPE, RADIUS } from './scale';

/** How far a row's highlight sits in from the row's sides (KAN-721, C2). */
export const ROW_GUTTER_PX = 4;

/** The highlight's own corner: a PANEL's, less the gutter it sits inside. */
export const ROW_RADIUS = RADIUS.CONTROL;

/**
 * A row whose fill stops ROW_GUTTER_PX in from each side at ROW_RADIUS.
 *
 * The fill stays on the row (specs read it there): transparent side borders
 * make the gutter, background-clip keeps the fill inside them. The horizontal
 * radius carries the gutter so the padding-box curve is ROW_RADIUS square.
 */
export function rowHighlightCss(): string {
  const row = Number.parseFloat(ROW_RADIUS);
  return `
    border-left: ${ROW_GUTTER_PX}px solid transparent;
    border-right: ${ROW_GUTTER_PX}px solid transparent;
    background-clip: padding-box;
    border-radius: ${row + ROW_GUTTER_PX}px / ${ROW_RADIUS};
    corner-shape: ${CORNER_SHAPE};
  `;
}
