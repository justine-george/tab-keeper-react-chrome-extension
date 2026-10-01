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
  /**
   * How far each saved WINDOW BLOCK moves while the row is held over another
   * window (KAN-184), keyed by window id. Absent means it does not move.
   *
   * A window cannot change height in a preview that holds the layout still, so
   * without this the destination could not make room: its rows below the
   * landing spilled out of their own block and over the next window's header,
   * and at its end no gap opened at all. Moving the windows BETWEEN the source
   * and the destination is what opens the row of space the drop will need.
   */
  windowShifts: Readonly<Record<string, number>>;
  // How far the block the HELD ROW sits in has moved, and how far the one the
  // LANDING sits in has (KAN-184). The row and the landing slot are drawn
  // inside those blocks, so each subtracts what its own block has already done
  // -- otherwise the row drifts off the pointer by a whole row, and the ghost
  // with it.
  heldWindowShift: number;
  landingWindowShift: number;
  /**
   * The fixed rows the drop REMOVES from the list, by key (KAN-169): a group's
   * title row and tail marker while its only member is held outside it. The
   * rows below them have already closed up in `shifts`; this is for whoever
   * draws the removed rows to stop drawing them. Empty while nothing goes.
   */
  removedFixedRows: readonly string[];
  /**
   * The held row is shown by a card at the pointer instead of by itself
   * (KAN-354): the drag published a drag card (its list's carryOut had one
   * for the row), or it is an adopted carry, whose card is the carry's
   * (KAN-350). The row is then drawn invisible in its own room, casts no lift
   * shadow (KAN-355), and its landing slot does not fade by distance -- there
   * is no visible row left to tell the slot apart from.
   *
   * False for every other drag: the session list's, Open now's, and a saved
   * list's row its carryOut has no card for. Those keep the sliding row.
   */
  heldShownAsCard: boolean;
  /**
   * How far below the held row's own place (its measured top) the outline
   * over the room it leaves is drawn (KAN-354 C3 A), or null when none is.
   *
   * A row held over ANOTHER window leaves its source one row shorter, and
   * that room shows at the source's BOTTOM: the rows below it close up, and
   * the source keeps its box until the release (KAN-184). The outline is the
   * held row's own box, bottom-aligned to the source's lowest slot as
   * measured at drag start; 0 when the held row is its window's last.
   *
   * Null with no card (the row is still drawn), for an adopted carry (its
   * source, the trailing block it rests in, holds nothing after the drop),
   * for a landing in
   * the row's own window, and for a refused one.
   */
  sourceRoomDelta: number | null;
  /**
   * Where the landing slot's left and right edges sit inside the held row's
   * box (KAN-364): the box of the row the item lands as, which a tab
   * crossing a group band's edge changes -- a member's row starts past the
   * band's colour bar, a loose row's does not. Positive moves an edge in.
   * Zero for every landing the held row's own box already describes.
   */
  landingInset: { left: number; right: number };
  /**
   * Whether the landing slot is drawn at all (KAN-365). Not for an adopted
   * carry whose release would be refused: that release moves nothing, and
   * the item goes back to its source, which is no place in this list -- the
   * held row is only the carry's phantom, so its own place is not where
   * anything lands. Every other drag draws it, a refused one at its own
   * place.
   */
  landingSlotShown: boolean;
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
  // The row standing in for a carried item, which the area adopts as its
  // drag when the pointer comes in (KAN-350). Drawn invisible, keeping its
  // footprint; undefined while this list offers no carried item a place.
  adoptRowId: string | undefined;
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
