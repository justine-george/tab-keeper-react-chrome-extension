import { ROW_GUTTER_PX } from '../../styles/rowHighlight';

// KAN-892. The tabs a saved window dropped on an open window added there, as
// the worker answered: Open now listens to show them. Outside Redux, like
// newWindowFollow: a live tab id is never stored.
export interface Arrival {
  windowId: number;
  tabIds: number[];
}

const listeners = new Set<(a: Arrival) => void>();

export function announceArrival(windowId: number, tabIds: number[]): void {
  for (const listener of [...listeners]) listener({ windowId, tabIds });
}

export function subscribeArrival(fn: (a: Arrival) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// The edges of a box on screen, as getBoundingClientRect gives them.
type Edges = Pick<DOMRectReadOnly, 'top' | 'bottom' | 'left'>;

// The arrival fill's box, in px from its window block's own edges.
export interface ArrivalBox {
  top: number;
  height: number;
  left: number;
  right: number;
}

// From the first new row's top to the last one's bottom, at the rows' left
// edge, ROW_GUTTER_PX in from the block's right as a row's highlight is.
export function arrivalBox(
  rows: readonly [Edges, ...Edges[]],
  block: Edges
): ArrivalBox {
  const top = Math.min(...rows.map((r) => r.top));
  const bottom = Math.max(...rows.map((r) => r.bottom));
  return {
    top: top - block.top,
    height: bottom - top,
    left: Math.min(...rows.map((r) => r.left)) - block.left,
    right: ROW_GUTTER_PX,
  };
}

// The approved mock's clearance between the new rows and the list's edge.
const SCROLL_CLEARANCE_PX = 8;

// How far a list showing `view` scrolls to show `span`, as block:'nearest'
// would: the least that shows it all, and when it can't fit, its top.
export function nearestScroll(
  span: Pick<Edges, 'top' | 'bottom'>,
  view: Pick<Edges, 'top' | 'bottom'>
): number {
  const top = span.top - SCROLL_CLEARANCE_PX;
  const bottom = span.bottom + SCROLL_CLEARANCE_PX;
  if (top < view.top) return top - view.top;
  if (bottom > view.bottom)
    return Math.min(bottom - view.bottom, top - view.top);
  return 0;
}
