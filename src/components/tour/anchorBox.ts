import {
  intersectBox,
  unionBox,
  type Box,
  type HoleCorners,
} from './coachMarkPlacement';

export type AnchorBox = (element: Element) => Box | null;

// KAN-900. What a step lights and leaves reachable in a hole of its own,
// outside the ring: each element `selector` finds, measured by `boxOf` (its
// own box by default), its hole in `corners` (a CONTROL's by default).
export interface Opening {
  selector: string;
  boxOf?: AnchorBox;
  corners?: HoleCorners;
}

// What a step lights instead of its ring's box: the first of `anchors` drawn, measured by `boxOf`.
export interface Spotlight {
  anchors: readonly string[];
  boxOf: AnchorBox;
}

const fromRect = (rect: DOMRect): Box => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
});

export const ownBox: AnchorBox = (element) =>
  fromRect(element.getBoundingClientRect());

// KAN-901. A session row's fill: its highlight's padding box, inside the
// transparent side borders that make the gutter (rowHighlight.ts), and above
// the divider under the row. A row with no highlight drawn is its own box.
export const rowFillBox: AnchorBox = (row) => {
  const fill = row.querySelector('[data-drag-handle-row]');
  if (fill === null) return ownBox(row);
  const rect = fill.getBoundingClientRect();
  return {
    left: rect.left + fill.clientLeft,
    top: rect.top + fill.clientTop,
    width: fill.clientWidth,
    height: fill.clientHeight,
  };
};

// What a scroll box shows: inside its border, without its scrollbar.
const clientBox = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left + element.clientLeft,
    top: rect.top + element.clientTop,
    width: element.clientWidth,
    height: element.clientHeight,
  };
};

// The nearest ancestor that scrolls; null when none does.
const scrollerOf = (element: Element): Element | null => {
  for (let el = element.parentElement; el !== null; el = el.parentElement) {
    const { overflow, overflowY } = getComputedStyle(el);
    if (/auto|scroll/.test(`${overflow} ${overflowY}`)) return el;
  }
  return null;
};

// KAN-999. A session row's fill, clipped to what its list shows: null for a
// row scrolled out of view, so no hole opens outside the list.
export const visibleRowFill: AnchorBox = (row) => {
  const fill = rowFillBox(row);
  const scroller = scrollerOf(row);
  return fill === null || scroller === null
    ? fill
    : intersectBox(fill, clientBox(scroller));
};

// The window rows, not their container (it holds a margin and the trailing block), clipped to the scroll box.
export const rowsBox: AnchorBox = (element) => {
  const rows = unionBox(
    [...element.querySelectorAll('[data-drag-row-id]')].map((row) =>
      fromRect(row.getBoundingClientRect())
    )
  );
  const scroller = element.parentElement;
  return rows === null || scroller === null
    ? rows
    : intersectBox(rows, clientBox(scroller));
};

// Step 2: Open now's search row and fold button, as drawn; null when none is drawn.
// KAN-900. Not the resize grip: it runs the window's height, so the box took in the whole list. It is an opening.
export const findAndFitBox: AnchorBox = (element) =>
  element.matches('[data-open-now-search]')
    ? unionBox(
        [
          element,
          ...document.querySelectorAll(
            '[data-pane="open-now"] [data-tour-anchor="fold"]'
          ),
        ].map((part) => fromRect(part.getBoundingClientRect()))
      )
    : ownBox(element);

// KAN-1021. A pane's panels: its column's content box, inside the padding
// that spaces them from the window's edges, so the strips of page above and
// below them stay dimmed.
export const panelsBox: AnchorBox = (pane) => {
  const column = pane.firstElementChild ?? pane;
  const rect = column.getBoundingClientRect();
  const style = getComputedStyle(column);
  const [top, right, bottom, left] = [
    style.paddingTop,
    style.paddingRight,
    style.paddingBottom,
    style.paddingLeft,
  ].map((value) => Number.parseFloat(value) || 0);
  return {
    left: rect.left + left,
    top: rect.top + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  };
};

// KAN-1021. The first element `selector` finds, as its own box; undefined when none is drawn.
export function boxOfFirst(selector: string): Box | undefined {
  const element = document.querySelector(selector);
  return element === null
    ? undefined
    : fromRect(element.getBoundingClientRect());
}
