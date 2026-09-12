import React, { useContext } from 'react';

// The live drag, and the context carrying it.
//
// Split out of RowDragArea.tsx because a file that exports components must
// export nothing else for Fast Refresh to work, and `useDragState` has to be
// importable by anything that must move WITH the rows without being one of
// them -- a group's title row and colour strip (KAN-165).

export interface DragState {
  rowId: string;
  // How far the held row has travelled from where it was picked up.
  offset: number;
  /**
   * How far each element of the list moves while the drag is over its current
   * landing slot, keyed by row id -- and by title-row key for the parts of the
   * list that are drawn but cannot be dragged (KAN-166).
   *
   * Elements that do not move are absent; read it as `shifts[key] ?? 0`.
   *
   * ONE ANSWER, computed once. This used to be an index range every consumer
   * re-derived for itself, which is how the landing slot and the rows it was
   * drawn among came to disagree -- and a group's frame, which is not a row at
   * all, had to GUESS its own shift from whether its members agreed. It cannot:
   * every member shifts alike both when the group is passed over and when it
   * gains a first member, and those move the frame opposite ways.
   */
  shifts: Readonly<Record<string, number>>;
  // How far every row the held row has passed must move to close up behind it
  // -- the room it occupies, not the height it measures (KAN-163).
  footprint: number;
  // How far the held row's own SLOT has travelled, so the landing placeholder
  // can be drawn in the gap that is opening for it (KAN-166). Zero while the
  // row would land back where it started.
  landingDelta: number;
}

export interface Ctx {
  register: (rowId: string, el: HTMLElement | null) => void;
  begin: (
    rowId: string,
    clientX: number,
    clientY: number,
    target: EventTarget | null
  ) => void;
  drag: DragState | null;
}

// The lists a row can join. `nearest` is what every unscoped row joins, as
// before scopes existed; `byScope` holds every enclosing list that declared a
// scope, so a row can name one through the lists in between (KAN-160).
export interface DragScopes {
  nearest: Ctx;
  byScope: Readonly<Partial<Record<string, Ctx>>>;
}

export const DragContext = React.createContext<DragScopes | null>(null);

/**
 * The live drag on a named list, or null when nothing is being dragged there.
 *
 * Same resolution as DraggableRow: a named scope, or the nearest enclosing
 * list. Must be called from inside the area, like any consumer of a context.
 */
export function useDragState(scope?: string): DragState | null {
  const scopes = useContext(DragContext);
  const ctx =
    (scope === undefined ? scopes?.nearest : scopes?.byScope[scope]) ?? null;
  return ctx?.drag ?? null;
}
