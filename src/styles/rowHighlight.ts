import { corners } from './corners';
import { CORNER_SHAPE, RADIUS } from './scale';

/** How far a row's highlight sits in from the row's sides (KAN-721, C2). */
export const ROW_GUTTER_PX = 4;

/** The scrollbar thumb's inset inside its track (App.css: a 2px transparent border). */
export const SCROLLBAR_THUMB_INSET_PX = 2;

/**
 * The row's right gutter, as a CSS value: ROW_GUTTER_PX, or less the thumb's
 * inset while the list shows a scrollbar, so the fill sits 4px from the thumb
 * as it does from the top and the left (his R6 pick). useScrollbarWidthVar
 * sets the variable on the list; everything that lines up with the gutter's
 * end reads it.
 */
export const ROW_GUTTER_END_VAR = '--row-gutter-end';
export const ROW_GUTTER_END = `var(${ROW_GUTTER_END_VAR}, ${ROW_GUTTER_PX}px)`;
export const ROW_GUTTER_BESIDE_BAR_PX =
  ROW_GUTTER_PX - SCROLLBAR_THUMB_INSET_PX;

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
 *
 * `fillFromRowStart`: an indented row (a tab, a group's header) has no panel
 * edge on its left, so its fill starts where the row does, in line with the
 * group band and the rows beside it; only its right end sits in the gutter.
 */
export function rowHighlightCss({
  fillFromRowStart = false,
}: { fillFromRowStart?: boolean } = {}): string {
  const row = Number.parseFloat(ROW_RADIUS);
  const end = `calc(${ROW_RADIUS} + ${ROW_GUTTER_END})`;
  // An indented row has no gutter on its left: its box, and every pointer
  // target beside it (the group strip), stay exactly where they were.
  const start = fillFromRowStart ? ROW_RADIUS : `${row + ROW_GUTTER_PX}px`;
  return `
    border-left: ${fillFromRowStart ? 0 : ROW_GUTTER_PX}px solid transparent;
    border-right: ${ROW_GUTTER_END} solid transparent;
    background-clip: padding-box;
    border-radius: ${start} ${end} ${end} ${start} / ${ROW_RADIUS};
    corner-shape: ${CORNER_SHAPE};
    ${
      fillFromRowStart
        ? ''
        : `& > [data-drag-handle] { margin-left: -${ROW_GUTTER_PX}px; }`
    }
  `;
}

/** On a row's in-flow content: it spans the row as it did before the gutter. */
export const ROW_PULL = `margin: 0 calc(-1 * ${ROW_GUTTER_END}) 0 -${ROW_GUTTER_PX}px;`;
/** On a row's first in-flow child: it starts where it did before the gutter. */
export const ROW_PULL_START = `margin-left: -${ROW_GUTTER_PX}px;`;

/** On an indented row's last in-flow child: it ends where it did before the gutter. */
export const ROW_PULL_END = `margin-right: calc(-1 * ${ROW_GUTTER_END});`;

/** A mask pinned to the row's right edge (right: 0) takes the fill's right corners. */
export const rowEndCorners = (): string =>
  corners(`${RADIUS.SQUARE} ${ROW_RADIUS} ${ROW_RADIUS} ${RADIUS.SQUARE}`);
