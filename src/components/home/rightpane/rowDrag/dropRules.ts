// What a drag MEANS, kept apart from how it is driven.
//
// RowDragArea beside this file owns the pointer mechanics; this owns the rules
// those mechanics apply, so each can be read and changed without the other.
// `bandAt` in particular is the whole membership decision in one testable
// function.
import type { ReactNode } from 'react';

import type { LandingSide } from '../../../../utils/functions/dragPreview';
import type { windowGroupData } from '../../../../redux/slices/tabContainerDataStateSlice';

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

// The boxes that hold a list's rows (KAN-132). A WeakSet rather than an
// attribute, so knowing them changes nothing in the DOM, and here rather than
// in RowDragArea.tsx, which may export components and nothing else.
const ROW_CONTAINERS = new WeakSet<Element>();

/**
 * A ref for a box that holds a list's rows, so no footprint is measured on it
 * or above it -- see `footprintOf`.
 *
 * Every drag area registers its own container. A list whose rows are drawn in
 * SEVERAL boxes has to mark the rest: the pane-wide `items` list and the
 * pane-wide `tabs` list each span every saved window, and each window still
 * draws a box around its own rows even though that box is no longer any
 * list's container. That box is not an area's container, and nothing else
 * tells it apart from the single-child wrappers the climb exists to climb.
 */
export function markRowContainer(el: HTMLElement | null): void {
  if (el) ROW_CONTAINERS.add(el);
}

export function isRowContainer(el: Element | null): boolean {
  return el !== null && ROW_CONTAINERS.has(el);
}

// A span of fixed rows a drop removes from the drawn list (KAN-169) -- see
// RowDragAreaProps.fixedRowsRemovedBy.
export interface RemovedFixedRows {
  // The first and last fixed row removed, by key, in drawn order. Everything
  // between them goes too; the only ROW between them is the dragged one.
  first: string;
  last: string;
  // The gap, in px, that the slot above `first` and the slot below `last` keep
  // between them once the span is gone.
  gapKept: number;
}

// Where a drop landed, beyond its index.
export interface DropTarget {
  // Which Chrome group band the pointer is over, if any.
  bandId: string | undefined;
}

// The engine cannot answer this itself: for tabs it is which Chrome group the
// pointer was over, and for windows there is no such question at all. So the
// area takes it as a function and stays ignorant of what the answer means --
// which is what lets one engine drive both lists (KAN-129).
//
// `within` is the element to search. For a list whose rows span several saved
// windows it is the LANDING window's block (KAN-132), so the answer can only
// name something a release there could land in; for any other list it is the
// list's own container.
export type ResolveDrop = (
  within: HTMLElement | null,
  x: number,
  y: number
) => DropTarget;

// Which list is being dragged. Only the CSS cares, but it has to come from the
// caller: the area itself has no idea what its rows represent, and that is
// deliberate -- see the file header on RowDragArea.
export type DragKind = 'tab' | 'window' | 'session' | 'group';

// The windows a pane-wide drag list spans, in render order, and the session
// they belong to. Both lists over a session take it: the `tabs` list in
// useTabDrop and the `items` list in useGroupDrop -- neither owns this shape
// any more than the other, so it lives here rather than in either hook.
export interface PaneWindows {
  tabGroupId: string;
  windows: readonly Pick<
    windowGroupData,
    'windowId' | 'tabs' | 'chromeTabGroups'
  >[];
}

export interface RowDragAreaProps {
  // Flat, in render order. For a list with no windows, index into this is what
  // onMove's toIndex means; for one whose rows sit in windows, see onMove.
  rowIds: string[];
  /**
   * A name rows can join this list by, through any lists nested in between
   * (KAN-160: a window's group list sits inside its tab list, and tab rows
   * must still join the tab list). Omitted, the list is reachable only as the
   * nearest one, which is how every list worked before scopes.
   */
  scope?: string;
  /**
   * Where a committed drop lands.
   *
   * For a list whose rows sit in saved windows, `toWindowId` is the window the
   * release landed in -- the row's own or another one (KAN-132) -- and
   * `toIndex` counts THAT window's rows with the held one lifted out, which is
   * the index its stored tabs take. For a list with no windows `toWindowId` is
   * undefined and `toIndex` counts every row.
   */
  onMove: (
    rowId: string,
    toIndex: number,
    dropTargetId?: string,
    toWindowId?: string
  ) => void;
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
   * A release over ANOTHER saved window lands in that window (KAN-132).
   *
   * OFF BY DEFAULT, and that is the half that matters. Off, every release is
   * judged in the window the held row came from: one over another window's
   * block names no row of the list being judged, so `isInsideList` refuses it,
   * and the index a drop reports can only ever be the source window's. A list
   * with no windows at all never reaches this question either way.
   *
   * On, the window under the pointer decides -- its header and a collapsed
   * window included, neither of which draws a row to hit.
   *
   * TURNING IT ON IS HALF A CHANGE. The index a drop then reports is counted
   * in a window the list's `onMove` did not pick, so that callback must route
   * on the window it is handed; one that applies the index to the held row's
   * own window instead commits a move nobody asked for. Both lists that set
   * this (`TabDragArea`, `GroupDragArea`) route on it.
   */
  dropsAcrossWindows?: boolean;
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
   * `resolveDrop` answers, with the list's own container -- the WHOLE list,
   * not the window the target sits in, so a mark left in the window the
   * pointer has just come from is cleared as well (KAN-132) -- and the list
   * decides how to show it. Fired only on CHANGE, so the cost is one hit test
   * per move rather than one DOM write.
   */
  onDropTargetChange?: (
    target: string | undefined,
    list: HTMLElement | null
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
   * Which fixed row the dragged row ends up beside, and on which side, when the
   * index alone does not describe where it ends up (KAN-166, KAN-168).
   *
   * A tab released inside a group's band joins that group, and the band's rect
   * includes the group's TITLE row -- while the landing index comes from row
   * midpoints, the first of which sits below that title. So in the strip at the
   * top of every group the index says "before the group" and the band says
   * "inside it". Both are right: the tab becomes the group's FIRST member, so
   * it lands under the title row rather than above it.
   *
   * THE SIDE IS THE WHOLE POINT, and leaving it out was KAN-168. A drop that
   * changes a tab's group crosses that group's title row, and it crosses in
   * both directions: joining at the head lands the tab under the title,
   * dragging out of the group lands it above. Neither changes the tab's row
   * index, so an index cannot express either one.
   *
   * The area cannot know any of this. It knows an index and whatever
   * `resolveDrop` answered; what a group IS, which row starts it, and which
   * group the dragged row is already in all belong to the list. So the list is
   * given the row's id and names the title row and the side, and the area works
   * out the slot -- including that the slot also depends on which direction the
   * row is travelling.
   *
   * The DROP is unaffected -- this shapes the preview only, and the reducer
   * still receives the raw index, which produces the same arrangement.
   *
   * `toIndex` counts the rows of ONE window -- `windowId`, the window the row
   * lands in -- and so does whatever the list compares it against (KAN-132).
   * In a list whose rows span several saved windows, each window's groups
   * start at a window-local index, and a group in another window must never
   * answer for this drop. `windowId` is undefined for a list with no windows.
   */
  landsBesideFixedRow?: (
    rowId: string,
    toIndex: number,
    target: string | undefined,
    windowId: string | undefined
  ) => { fixedRowId: string; side: LandingSide } | undefined;
  /**
   * Which fixed rows the drop REMOVES, when it removes any (KAN-169).
   *
   * Every other question here is about where something moves. This one is
   * about something that ceases to exist: a group whose only member is the
   * dragged tab is pruned the moment that tab lands anywhere outside it -- in
   * another group, loose, or in another window -- and its title row, tail
   * marker and margins go with it. The drawn list was measured with all of
   * them in it, so unless the list says so the preview shifts the title row
   * aside as if the group survived, and draws every row below the band where
   * the drop will not put it.
   *
   * The area removes the span `first..last` from the preview: those fixed
   * rows are reported in `DragState.removedFixedRows` so the list can stop
   * drawing them, and every slot below the span closes up by the room the span
   * gives back -- measured between the two slots either side of it, less the
   * dragged row's own height (previewShifts already carries that to wherever
   * it lands) and less `gapKept`, the space those two neighbours keep between
   * them once the span is gone. Only the list knows that last number: it is
   * the list's own spacing, and it depends on what the neighbours ARE.
   *
   * Same arguments as landsBesideFixedRow, and asked in the same breath; the
   * two are different questions about the same release and either may be
   * answered without the other. The DROP is unaffected.
   */
  fixedRowsRemovedBy?: (
    rowId: string,
    toIndex: number,
    target: string | undefined,
    windowId: string | undefined
  ) => RemovedFixedRows | undefined;
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
    // THE CONTENT BOX, not the border box (KAN-171). While a tab is being
    // dropped into a group, the band grows by one row's worth of padding so its
    // tint can show the group the release will make -- and that padding must
    // not enlarge what the pointer can hit. It did, and the result was a LATCH:
    // marking a band made the band bigger, which kept the pointer inside it,
    // which kept it marked. Measured in CI, a pointer moved clear of every band
    // left one still lit.
    //
    // Growing the frame previews the RESULT. It is not a bigger target.
    //
    // Read off the inline style rather than a computed one because this runs
    // for every band on every pointer move; the follower writes it there.
    const padBottom = parseFloat(band.style.paddingBottom) || 0;
    // How far the growth actually MOVED the box, published by the follower
    // (KAN-180). Rebuilding it here as `rect.top + paddingTop` was 2px out --
    // the negative margin that absorbs the padding collapses differently with
    // the row above, so the box does not move by the padding alone. Two pixels
    // was enough to latch: the pointer marked the band, the band grew, the
    // boundary moved past the pointer, and it unmarked again on the next move.
    const grewBy = parseFloat(band.dataset.bandGrewBy ?? '') || 0;
    if (
      x >= r.left &&
      x <= r.right &&
      y >= r.top + grewBy &&
      y <= r.bottom - padBottom
    ) {
      return band.dataset.bandId;
    }
  }
  return undefined;
}

/**
 * The group a landing sits immediately past the end of, if any.
 *
 * KAN-181, and the mirror of the head rule KAN-174 settled. A tab landing
 * ungrouped right after a group takes the SAME SLOT as one joining that group
 * at its tail, so the row index cannot tell the two apart -- the group's frame
 * is what says which one the release will be. Unnamed, the group's tail marker
 * (KAN-176) stays outside the shift range while its members move, and the
 * colour strip hangs a row below the last member, over the slot the tab is
 * about to take.
 *
 * Indices are in LANDING SPACE: the list with the held row already lifted out.
 * A held row at or above the group's last member shuffles that member up one,
 * and `<=` rather than `<` is the difference from the head rule: the held row
 * can BE the last member, and a group losing its last member ends one row
 * earlier than the stored list says.
 */
export function groupEndingAbove(
  lastIndexByGroup: ReadonlyMap<string, number>,
  fromIndex: number | undefined,
  toIndex: number
): string | undefined {
  for (const [groupId, lastIndex] of lastIndexByGroup) {
    const end =
      fromIndex !== undefined && fromIndex <= lastIndex
        ? lastIndex - 1
        : lastIndex;
    if (toIndex === end + 1) return groupId;
  }
  return undefined;
}

// The marker WindowEntryContainer puts on each saved window's whole block
// (KAN-132).
const WINDOW_MARKER = '[data-drop-window-id]';

// The saved-window block an element sits in, or null outside every one -- a
// window's own row in the window list, a row that is not rendered, or a list
// with no windows at all.
//
// Structural rather than a hit test: the engine uses it to learn which window
// each ROW belongs to, and which window the held row came from, neither of
// which depends on where the pointer is.
export function windowOf(el: Element | null | undefined): HTMLElement | null {
  return el?.closest<HTMLElement>(WINDOW_MARKER) ?? null;
}

// WHICH WINDOW a drop landed in (KAN-132), answered with the block itself so
// the engine can search it for bands. The same idiom as bandAt, and for the
// same reason: resolved from rects rather than from the engine's collision
// result, so the answer does not depend on how the rows were measured.
//
// Marked on the WHOLE window block -- header and tabs together, whether the
// window is open or collapsed -- not on the tab-list container inside it. A
// drop on a window's header, and a drop anywhere on a collapsed window (which
// renders no tab list at all), both mean "into this window at index 0", and
// neither has a tab-list container to hit; the block is the one element
// that's always there to answer for both.
export function windowBlockAt(
  container: HTMLElement | null,
  x: number,
  y: number
): HTMLElement | null {
  // THE BLOCKS' RESTING BOXES, not where the preview has moved them (KAN-184).
  //
  // While a row is held over another window, the blocks after it are translated
  // to open the room the drop needs, so their live rects are not where the drag
  // measured them. Hit-testing those would let the preview decide what the
  // pointer can reach -- and a window that slides under the pointer while it is
  // being pointed at is the LATCH that KAN-171 had to fix for a band's padding.
  // Growing a preview shows the result; it is not a moved target.
  //
  // Read off the attribute the block publishes, for the same reason bandAt
  // reads the inline padding: this runs for every window on every pointer move.
  const boxes = windowBlocksIn(container).map((el) => {
    const r = el.getBoundingClientRect();
    const shift = parseFloat(el.dataset.windowShift ?? '') || 0;
    return {
      el,
      left: r.left,
      right: r.right,
      top: r.top - shift,
      bottom: r.bottom - shift,
    };
  });

  for (const b of boxes) {
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return b.el;
  }

  // THE GAP BETWEEN TWO WINDOWS BELONGS TO THE NEARER OF THEM (KAN-185).
  //
  // Windows sit 8px apart, and a pointer in that gap used to name no window at
  // all. The drop then fell back to the window the row came from, could not
  // place it there either, and previewed NO CHANGE -- so dragging slowly across
  // the boundary showed the landing snap home to the row's own origin and out
  // again, measured over a 6px band. The boundary between two windows is a
  // point, not a band: the landing changes hands at the middle of the gap.
  //
  // Only BETWEEN two blocks. Above the first and below the last, naming a
  // window is exactly what must not happen -- that is the release beside the
  // pane that isInsideList is there to refuse (KAN-132).
  for (let i = 0; i + 1 < boxes.length; i++) {
    const above = boxes[i];
    const below = boxes[i + 1];
    if (
      y > above.bottom &&
      y < below.top &&
      x >= above.left &&
      x <= above.right
    ) {
      return y - above.bottom <= below.top - y ? above.el : below.el;
    }
  }
  return null;
}

// Every saved-window block below `container`, in document order.
export function windowBlocksIn(container: HTMLElement | null): HTMLElement[] {
  return container
    ? [...container.querySelectorAll<HTMLElement>(WINDOW_MARKER)]
    : [];
}

// Did the drop land inside the rows it is judged against?
//
// WHICH ROWS DEPENDS ON THE LIST, and there are two cases (KAN-132).
//
// For a list that drops ACROSS WINDOWS, this judges only a release OUTSIDE
// every window's block. Inside one, the release lands in that window -- its
// header and a collapsed window included -- and there is nothing to judge.
// Outside all of them the only window still in play is the one the row came
// from, and RowDragArea hands this that window's rows. So what it guards for
// such a list is a release in the gaps between windows and beside the pane:
// within half a row of the row's own window it is the "drag it to the end"
// overshoot, and anywhere else it names no window and is refused.
//
// THE TEST IS Y-ONLY (`y`, no `x`), so "beside the pane" is not actually
// guarded here: a release outside every window's block but level with the
// held row's own window's rows -- to the left or right of the pane entirely
// -- still falls inside the y band and is ACCEPTED, unchanged from main. That
// is the overshoot case above, not a refusal; nothing downstream of this
// function re-checks x for a list with no windows of its own.
//
// For a list that does NOT -- `dropsAcrossWindows` off, which is the default,
// though no list whose rows sit IN windows leaves it off any more -- every
// release is handed the SOURCE window's rows, including one squarely over
// another window's block, because no other window is ever in play. Being
// refused here IS the mechanism by which such a list cannot leave its window,
// so it is reached on the common path rather than only in the gaps.
//
// Two lists still leave it off, and neither reaches this branch: the windows
// area (TabGroupDetailsContainer) and the left pane's session list
// (TabGroupEntryContainer). Their rows wrap window blocks, or sit in no window
// at all, so `l.heldWindow` is null and the question never arises -- they take
// the paragraph below instead.
//
// A list with no windows passes all of its rows, and for it this is the whole
// rule.
//
// HISTORY. This was KAN-132's interim guard, written when a release over
// ANOTHER window could not yet be a move for any list: each window had a list
// of its own, so the index SATURATED at the bottom of the window the row came
// from, and the session was dirtied for a cloud write. Refusing was the honest
// answer until the drop was built. It is built now, for tabs and for whole
// groups alike, which is why neither reaches this function from inside another
// window's block -- only from the space between blocks and beside the pane.
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
  slack: number,
  drawnTop?: number
): boolean {
  if (rows.length === 0) return false;
  let top = Infinity;
  let bottom = -Infinity;
  for (const row of rows) {
    top = Math.min(top, row.mid - row.height / 2);
    bottom = Math.max(bottom, row.mid + row.height / 2);
  }
  // The list the USER sees starts at its first drawn thing, not its first
  // draggable row (KAN-173). When a group leads a window, a whole title row
  // sits above the topmost row, and measuring from the row put the list's edge
  // BELOW chrome that plainly belongs to it.
  //
  // That made "before the group" unaddressable. The only pointer positions
  // that count as landing at index 0 are above the first member's midpoint;
  // inside the band that means "join at the head" (KAN-166), and above the
  // band the release was refused -- so no position meant "before" at all.
  //
  // Only the top edge moves, and only onto chrome the list already draws. The
  // bottom stays measured from the rows, because past it -- and past the slack
  // -- a release names no row of this list, and accepting it would saturate at
  // the bottom (KAN-132's original defect).
  if (drawnTop !== undefined) top = Math.min(top, drawnTop);
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
