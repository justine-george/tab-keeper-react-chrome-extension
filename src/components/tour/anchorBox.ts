import { intersectBox, unionBox, type Box } from './coachMarkPlacement';

export type AnchorBox = (element: Element) => Box | null;

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
