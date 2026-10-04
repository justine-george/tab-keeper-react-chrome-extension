// KAN-379. The drag's snapshot, and its patch when a folded window opens.
import type { WindowedSlot } from '../../../../utils/functions/dragPreview';

// A box's left and right edges, in viewport space. Nothing a drag does moves
// a row sideways, so they hold for the whole drag as measured.
export interface Edges {
  left: number;
  right: number;
}

export interface Rect {
  id: string;
  index: number;
  mid: number;
  height: number;
  // Top edge, in the same content space as `mid`. The landing slot is placed
  // from it (KAN-166): its position is a DISTANCE between measured tops, and
  // summing footprints would not do -- the `tabs` scope is not contiguous in
  // layout, so the gap between two consecutive rows can hold a group's band
  // header belonging to neither.
  top: number;
  // Which saved window the row sits in, read once at drag start (KAN-132), or
  // undefined for a row in none -- a window's own row, a row that is not
  // rendered, or a list with no windows at all. A list whose rows span several
  // windows answers every drop question within ONE of them, and this is what
  // picks that window's rows out.
  windowId: string | undefined;
  // The row's left and right edges, and the group band it sits in, if any
  // (KAN-364): where a row of its kind sits across, which is what the
  // landing slot takes. Read with the rest, once.
  edges: Edges;
  bandId: string | undefined;
}

// A slot in the list as drawn, tagged like a row with the window it sits in.
export type Slot = WindowedSlot;

// The list AS DRAWN (KAN-166): the rows, plus whatever fixed parts the list
// declared, ordered by where they actually sit. Ordered by measured top
// rather than by document order, because a fixed row is rendered inside the
// thing it labels and its position in the markup says nothing about its
// position on screen. A row not drawn when measured sits at 0: it sorts first.
export function drawnList(
  rects: readonly Rect[],
  fixed: readonly Slot[]
): { slots: Slot[]; slotOfRow: number[]; slotOfFixed: Map<string, number> } {
  const slots = [
    ...rects.map((r) => ({
      key: r.id,
      top: r.top,
      height: r.height,
      windowId: r.windowId,
    })),
    ...fixed,
  ].sort((a, b) => a.top - b.top);

  // Row index -> slot index, and fixed-row key -> slot index.
  const slotOfRow: number[] = [];
  const slotOfFixed = new Map<string, number>();
  const rowAt = new Map(rects.map((r) => [r.id, r.index]));
  slots.forEach((slot, index) => {
    const row = rowAt.get(slot.key);
    if (row !== undefined) slotOfRow[row] = index;
    else slotOfFixed.set(slot.key, index);
  });
  return { slots, slotOfRow, slotOfFixed };
}

// What a release can land as, across (KAN-364). A member's box for each
// band, from any row drawn in it -- the held row too, which may be its
// band's only member. A loose row's from any OTHER drawn row in no band:
// the held row is the one row whose box can be neither (an adopted
// carry's phantom rests in the trailing block). With no loose row
// drawn, a band's own box (`anyBand`), which sits where a loose row does. One
// box for every window the list spans: they share one column and one
// indent (70px, in the saved pane and in Open now alike). A layout that put
// windows side by side would need a box per window.
export function landingBoxes(
  rects: readonly Rect[],
  fromIndex: number,
  anyBand: Edges | null
): { memberEdges: Map<string, Edges>; looseEdges: Edges | null } {
  const memberEdges = new Map<string, Edges>();
  for (const r of rects) {
    if (r.height > 0 && r.bandId !== undefined && !memberEdges.has(r.bandId))
      memberEdges.set(r.bandId, r.edges);
  }
  const looseRow = rects.find(
    (r) => r.height > 0 && r.bandId === undefined && r.index !== fromIndex
  );
  return { memberEdges, looseEdges: looseRow?.edges ?? anyBand };
}

// What an open moves, all in content space.
export interface Measured {
  rects: Rect[];
  // The fixed rows the list declared, kept apart to rebuild the drawn list.
  fixed: Slot[];
  windowTops: Map<string, number>;
  windowBottoms: Map<string, number>;
  listTops: Map<string | undefined, number>;
  maxScroll: number;
}

// A row of the opened window, read in content space once it is drawn.
export type UnfoldedRow = Pick<
  Rect,
  'id' | 'top' | 'height' | 'edges' | 'bandId'
>;

export interface Unfold {
  windowId: string;
  // How much taller the window's block is drawn open than when measured.
  growth: number;
  rows: readonly UnfoldedRow[];
  fixed: readonly Omit<Slot, 'windowId'>[];
}

// As if measured open, bar its list top: only the held row's window uses one.
export function afterUnfold(measured: Measured, unfold: Unfold): Measured {
  const top = measured.windowTops.get(unfold.windowId);
  if (top === undefined) return measured;
  const growth = unfold.growth;
  // A row of a window still folded sits at 0, above every window: it stays.
  const moved = (y: number) => (y > top ? y + growth : y);
  const movedAll = <K>(map: Map<K, number>) =>
    new Map([...map].map(([key, y]) => [key, moved(y)] as const));

  const read = new Map(unfold.rows.map((r) => [r.id, r]));
  const rects = measured.rects.map((r): Rect => {
    const opened = read.get(r.id);
    if (opened !== undefined) {
      return {
        ...r,
        ...opened,
        mid: opened.top + opened.height / 2,
        windowId: unfold.windowId,
      };
    }
    return r.top > top ? { ...r, top: r.top + growth, mid: r.mid + growth } : r;
  });

  return {
    rects,
    fixed: [
      ...measured.fixed.map((f) => ({ ...f, top: moved(f.top) })),
      ...unfold.fixed.map((f) => ({ ...f, windowId: unfold.windowId })),
    ],
    windowTops: movedAll(measured.windowTops),
    windowBottoms: movedAll(measured.windowBottoms),
    listTops: movedAll(measured.listTops),
    maxScroll: measured.maxScroll + growth,
  };
}
