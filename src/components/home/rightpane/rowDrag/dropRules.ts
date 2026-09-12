// What a drag MEANS, kept apart from how it is driven.
//
// RowDragArea beside this file owns the pointer mechanics; this owns the rules
// those mechanics apply, so each can be read and changed without the other.
// `bandAt` in particular is the whole membership decision in one testable
// function.
import type { ReactNode } from 'react';

export const ACTIVATION_DISTANCE_PX = 5;

// Form fields and editable regions: a press inside one begins typing or a
// text selection, never a drag (KAN-162). contenteditable="false" opts a
// region back out. An attribute selector, not isContentEditable, because
// jsdom does not implement that property.
const EDITABLE_FIELD =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function isInEditableField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_FIELD) !== null;
}

// Where a drop landed, beyond its index.
//
// The engine cannot answer this itself: for tabs it is which Chrome group the
// pointer was over, and for windows there is no such question at all. So the
// area takes it as a function and stays ignorant of what the answer means --
// which is what lets one engine drive both lists (KAN-129).
export type ResolveDrop = (
  container: HTMLElement | null,
  x: number,
  y: number
) => string | undefined;

// Which list is being dragged. Only the CSS cares, but it has to come from the
// caller: the area itself has no idea what its rows represent, and that is
// deliberate -- see the file header on RowDragArea.
export type DragKind = 'tab' | 'window' | 'session' | 'group';

export interface RowDragAreaProps {
  // Flat, in render order. Index into this is what onMove's toIndex means.
  rowIds: string[];
  /**
   * A name rows can join this list by, through any lists nested in between
   * (KAN-160: a window's group list sits inside its tab list, and tab rows
   * must still join the tab list). Omitted, the list is reachable only as the
   * nearest one, which is how every list worked before scopes.
   */
  scope?: string;
  onMove: (rowId: string, toIndex: number, dropTargetId?: string) => void;
  // A CSS selector for the part of a row that starts a drag. Omitted, the whole
  // row does.
  //
  // This is what makes nesting safe. A window's draggable node wraps its header
  // AND its tabs, so without a handle every tab drag would begin a window drag
  // underneath it. The two areas need no other coordination: only the one whose
  // `begin` runs owns the gesture.
  handleSelector?: string;
  dragKind?: DragKind;
  /**
   * Treat a release anywhere inside the list's pane -- the nearest
   * `overflow: auto` box, whether or not it currently overflows -- as a drop
   * on this list, landing at whichever end the pointer is past (KAN-155).
   *
   * OFF BY DEFAULT, and that is the important half. `isInsideList` exists to
   * stop a tab dragged OUT of its window saturating at the bottom of the window
   * it came from -- see the comment on that function, and KAN-132. Turning this
   * on for the tab lists would hand that defect straight back.
   *
   * It is on for the two lists that are the only list in their pane, where a
   * release in empty space below the rows can mean nothing else. It matters
   * because collapsing during a window drag leaves the folded list occupying a
   * fraction of the pane -- measured, 190px of rows in a 417px pane -- so the
   * dead zone underneath is large and easy to release into.
   */
  clampDropToEnds?: boolean;
  /**
   * After a drag that commits nothing -- Escape, or a release the list
   * refuses -- put the scroll back where it was when the row was picked up
   * (KAN-157).
   *
   * For a list whose drag CHANGES ITS OWN LAYOUT. A window drag folds every
   * window shut, the browser clamps the scroll to fit, and unfolding does not
   * give the position back: measured, five windows scrolled to 300 ended at 0
   * with the held window off screen. A committed drop recovers by following
   * the dropped row; a drag that moved nothing had nothing to follow.
   *
   * Off for the tab lists, which fold nothing: there the only scrolling a drag
   * does is the auto-scroll the user asked for by holding near an edge.
   */
  restoreScrollIfNoDrop?: boolean;
  resolveDrop?: ResolveDrop;
  /**
   * Called while the drag is live, whenever `resolveDrop` starts or stops
   * naming a target, and once with `undefined` when the drag ends (KAN-164).
   *
   * Because a drop can change more than an index. A tab released inside a
   * group's band JOINS that group, and before this the rule was invisible --
   * measured mid-drag with the pointer squarely inside a band, the band was
   * byte-identical to its resting state, so the only way to learn what a
   * release would do was to do it.
   *
   * The area stays ignorant of what a target IS: it forwards whatever
   * `resolveDrop` answers, with the container that answered, and the list
   * decides how to show it. Fired only on CHANGE, so the cost is one hit test
   * per move rather than one DOM write.
   */
  onDropTargetChange?: (
    target: string | undefined,
    container: HTMLElement | null
  ) => void;
  /**
   * A CSS selector for the parts of the list that are DRAWN but cannot be
   * dragged -- for tabs, each group's title row (KAN-166).
   *
   * The preview has to account for them or it cannot describe a drop that
   * changes a tab's group. Such a drop leaves the tab's row index alone and
   * only moves it past the title row, so in a list of rows alone there is
   * nothing to say, while the layout genuinely rearranges.
   *
   * Each match carries its own key in `data-fixed-row-id`, which is what
   * `landsAfterFixedRow` names and what `DragState.shifts` reports it under.
   *
   * OPT-IN PER LIST, because lists nest and a title row is only fixed in one of
   * them: in the `items` list a group is a single row that CONTAINS its title,
   * so the title moves with it and must not be counted twice.
   */
  fixedRowSelector?: string;
  /**
   * Which fixed row the dragged row will land immediately after, when the index
   * alone does not describe where it ends up (KAN-166).
   *
   * A tab released inside a group's band joins that group, and the band's rect
   * includes the group's TITLE row -- while the landing index comes from row
   * midpoints, the first of which sits below that title. So in the strip at the
   * top of every group the index says "before the group" and the band says
   * "inside it". Both are right: the tab becomes the group's FIRST member, so
   * it lands under the title row rather than above it.
   *
   * The area cannot know that. It knows an index and whatever `resolveDrop`
   * answered; what a group IS, and which row starts it, belong to the list. So
   * the list names the title row and the area works out the rest -- including
   * that the answer differs by direction, since a row arriving from above SWAPS
   * with the title row while one arriving from below lands past it.
   *
   * The DROP is unaffected -- this shapes the preview only, and the reducer
   * still receives the raw index, which produces the same arrangement.
   */
  landsAfterFixedRow?: (
    toIndex: number,
    target: string | undefined
  ) => string | undefined;
  // Dragging is off while the list on screen is a FILTERED view of the stored
  // one (KAN-131). toIndex counts rendered rows, and the reducers apply it to
  // the stored array, so a drag in a narrowed list lands somewhere the user
  // never pointed at.
  //
  // Only `begin` is guarded, deliberately: a drag already in flight cannot be
  // disabled out from under itself, because reaching the search box means
  // releasing the pointer.
  disabled?: boolean;
  children: ReactNode;
}

export interface DraggableRowProps {
  rowId: string;
  /**
   * The named list this row joins. Omitted, it joins the nearest enclosing
   * list. A name no enclosing list declared leaves the row inert.
   */
  scope?: string;
  children: ReactNode;
}

// THE DROP RULE FOR TABS: the band decides. A tab released while the pointer is
// inside a group's band -- padding included, since getBoundingClientRect covers
// it -- joins that group; anywhere else it lands ungrouped.
//
// Resolved from rects rather than from the engine's own collision result, so
// both prototypes answered this question identically. Bands are marked with
// data-band-id in WindowEntryContainer.
//
// Windows pass no resolveDrop at all: a window has no membership, so its drop
// rule really is just an index.
export function bandAt(
  container: HTMLElement | null,
  x: number,
  y: number
): string | undefined {
  if (!container) return undefined;
  for (const band of container.querySelectorAll<HTMLElement>(
    '[data-band-id]'
  )) {
    const r = band.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return band.dataset.bandId;
    }
  }
  return undefined;
}

// Did the drop land in the list that owns it? (KAN-132, interim.)
//
// Lists nest: a window's rows contain a window's worth of tab rows, and each
// window's tab list is its own area over its own tabs. So a drop can only ever
// name an index INSIDE the source list -- and dragging a tab out of its window
// did not fail, it SATURATED, landing the tab at the bottom of the window it
// came from and dirtying the session for a cloud write. Doing nothing is the
// honest answer until KAN-132 makes it a real move.
//
// Measured against the rows as they were AT DRAG START, which is the same
// snapshot toIndex is derived from. Re-reading the DOM at drop time would
// measure a layout the drag itself has already shifted, and comparing that
// against a pre-drag index is its own bug.
//
// `slack` exists because "drag it to the end" is a real gesture and people
// overshoot the last row while doing it. Half the held row is enough to be
// forgiving without reaching the next list -- the caller passes it.
export function isInsideList(
  rows: { mid: number; height: number }[],
  y: number,
  slack: number
): boolean {
  if (rows.length === 0) return false;
  let top = Infinity;
  let bottom = -Infinity;
  for (const row of rows) {
    top = Math.min(top, row.mid - row.height / 2);
    bottom = Math.max(bottom, row.mid + row.height / 2);
  }
  return y >= top - slack && y <= bottom + slack;
}

// Publish "a drag is in flight" on the document, for App.css to react to.
//
// It goes on the document rather than the row because during a drag the pointer
// travels over other rows, gaps and bands, and anything scoped to the source
// element stops applying the moment it leaves -- which reads as the drag
// letting go.
//
// A FLAG, not a style. This used to set `document.body.style.cursor` directly,
// and that was set-and-inert (KAN-134): `cursor` inherits, but an explicit
// declaration on a descendant beats an inherited value whatever its importance,
// and every row in this pane declares `cursor: pointer`. Measured in the popup,
// the body read `grabbing` while the element under the pointer computed
// `pointer` for the entire gesture -- and the test asserting the body's own
// style passed throughout.
//
// So the rule has to apply to the elements themselves, which means a selector
// (`[data-dragging] *`) rather than a property set on one node. The styles live
// in App.css; this only says when they apply. It also carries `user-select`,
// which had the same shape and is now in the same rule.
export function setDragging(on: boolean, kind: DragKind = 'tab'): void {
  // The KIND is published, not just the fact (KAN-153). A window drag collapses
  // every window's tab list so the whole session fits on screen, and that rule
  // must not fire during a TAB drag -- it would hide the very list being
  // reordered. Existing `[data-dragging]` rules are unaffected: an attribute
  // selector matches whatever the value is.
  if (on) document.documentElement.setAttribute('data-dragging', kind);
  else document.documentElement.removeAttribute('data-dragging');
}
