import { corners } from './corners';
import { CORNER_SHAPE, RADIUS } from './scale';

/** How far a row's highlight sits in from the row's sides (KAN-721, C2). */
export const ROW_GUTTER_PX = 4;

/** The highlight's own corner: a PANEL's, less the gutter it sits inside. */
export const ROW_RADIUS = RADIUS.CONTROL;

/**
 * A row whose fill stops ROW_GUTTER_PX in from each side at ROW_RADIUS.
 *
 * The fill stays on the row (specs read it there): transparent side borders
 * make the gutter, background-clip keeps the fill inside them, and an inset
 * shadow is drawn inside them already. The horizontal radius carries the
 * gutter so the padding-box curve is ROW_RADIUS square. A drag handle placed
 * from the row's edge is put back where it was.
 */
export function rowHighlightCss(): string {
  const row = Number.parseFloat(ROW_RADIUS);
  return `
    border-left: ${ROW_GUTTER_PX}px solid transparent;
    border-right: ${ROW_GUTTER_PX}px solid transparent;
    background-clip: padding-box;
    border-radius: ${row + ROW_GUTTER_PX}px / ${ROW_RADIUS};
    corner-shape: ${CORNER_SHAPE};
    & > [data-drag-handle] {
      margin-left: -${ROW_GUTTER_PX}px;
    }
  `;
}

/** On a row's in-flow content: it spans the row as it did before the gutter. */
export const ROW_PULL = `margin: 0 -${ROW_GUTTER_PX}px;`;
/** Where a row has several in-flow children: the first starts, and the last ends, as before. */
export const ROW_PULL_START = `margin-left: -${ROW_GUTTER_PX}px;`;
export const ROW_PULL_END = `margin-right: -${ROW_GUTTER_PX}px;`;

/** A mask pinned to the row's right edge (right: 0) takes the fill's right corners. */
export const rowEndCorners = (): string =>
  corners(`${RADIUS.SQUARE} ${ROW_RADIUS} ${ROW_RADIUS} ${RADIUS.SQUARE}`);
