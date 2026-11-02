import { edgeScrollStep } from '../rightpane/rowDrag/edgeScroll';

type Edges = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;

// KAN-895. How far a window carry held at (x, y) scrolls the list this frame,
// as a tab carry does (KAN-152): only inside the list, above the New window
// box below the last window when it shows there (R16 pins it), so on the box
// nothing scrolls.
export function windowCarryScrollStep(
  list: Edges,
  boxBelow: Edges | null,
  x: number,
  y: number
): number {
  const bottom =
    boxBelow !== null && boxBelow.top > list.top && boxBelow.top < list.bottom
      ? boxBelow.top
      : list.bottom;
  if (x < list.left || x >= list.right || y < list.top || y >= bottom) return 0;
  return edgeScrollStep(
    { top: list.top, bottom, height: bottom - list.top },
    y
  );
}
