// Drag to reorder a list of rows, driven directly by pointer events. Two lists
// use it: tabs within a saved window (KAN-128) and windows within a saved
// session (KAN-129).
//
// Chosen over @dnd-kit after building both and measuring: dnd-kit cost 14.91 kB
// gzip against 1.47 kB here (a 10x difference, ~9% of the whole gzipped bundle),
// its default `attributes` nested a button around every row and announced a
// keyboard drag this feature does not ship, and owning the motion outright
// keeps the reorder animation in the same system as the micro-animations
// planned for these rows rather than composing around a library's.
//
// The keyboard is deliberately not a path here: the rows already bind Enter and
// Space to "open this", so a keyboard pick-up would need its own affordance.
// Opening, deleting and renaming all remain keyboard-operable.
//
// This file knows nothing about tabs, windows or Chrome groups. What a drop
// MEANS beyond its index arrives as `resolveDrop`; which part of a row may
// start a drag arrives as `handleSelector`. Both live in dropRules.ts.
//
// TWO ELEMENTS, TWO JOBS. This node owns transform, transition, the lift shadow
// and z-index; the row inside it keeps background-color for selection and the
// inset shadow for hover, and its own transform stays free. Never move a row
// state onto this node's transform, or the reorder motion and that state will
// fight over one channel.
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  DragContext,
  type Ctx,
  type DragState,
  type DragScopes,
} from './dragContext';
import {
  ACTIVATION_DISTANCE_PX,
  isInEditableField,
  isInsideList,
  isRowContainer,
  markRowContainer,
  setDragging,
  windowBlockAt,
  windowBlocksIn,
  windowOf,
  type DraggableRowProps,
  type RowDragAreaProps,
} from './dropRules';
import {
  freedByRemoving,
  landingDeltaAcross,
  landingDeltaOf,
  previewShifts,
  previewShiftsAcross,
  removalShifts,
  slotLandingBeside,
  windowShiftsAcross,
  type LandingSide,
  type WindowedSlot,
} from '../../../../utils/functions/dragPreview';

// How close to an edge the pointer must be for the list to start travelling,
// and how fast it goes at its deepest. 48px is roughly a row and a half here,
// which is wide enough to hit without aiming and narrow enough that ordinary
// dragging near the ends does not trigger it.
const EDGE_ZONE_PX = 48;
// How strongly the landing slot draws when it is clear of the held row.
const SLOT_OPACITY = 0.3;
const MAX_SCROLL_PX_PER_FRAME = 14;

// The nearest ancestor that actually scrolls.
//
// Resolved from the ROW rather than from the drag area, because the area is
// often not the scroller -- the session list scrolls at a container two levels
// above the rows, and the right pane scrolls above both drag areas it holds.
// Walking up from the row finds whichever one it happens to be.
function scrollableAncestor(from: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = from?.parentElement ?? null;
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// The box the list lives in: the nearest ancestor that scrolls OR COULD.
//
// Not scrollableAncestor, which skips a container whose content happens to fit
// -- the right thing for auto-scroll, where there is nothing to scroll, and the
// wrong thing here. A two-window session never overflows its pane, and the dead
// space under its folded rows is still that pane; measured in the popup, the
// scrolling-ancestor version refused exactly that release (KAN-155).
function paneOf(from: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = from?.parentElement ?? null;
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
    el = el.parentElement;
  }
  return null;
}

interface Rect {
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
}

// A slot in the list as drawn, tagged like a row with the window it sits in.
type Slot = WindowedSlot;

// Where a release lands: in which window, and at which index AMONG THAT
// WINDOW'S ROWS with the held one lifted out -- the index the list applies to
// that window's stored tabs (KAN-132). In a list with no windows the window is
// undefined and the index counts every row, exactly as it did before a list
// could span windows.
interface Landing {
  windowId: string | undefined;
  index: number;
}

// How much room a row takes up: its border box plus the margin that separates
// it from the row beside it. Lifting it out of the flow closes exactly this
// much, wherever it sits, which is what the preview shifts every passed row by.
//
// Not the same number as its height, and the difference is why KAN-163 existed.
// Every row is a wrapper this file owns, holding a block the list owns, and
// that block's margin COLLAPSES THROUGH the wrapper -- the wrapper sets no
// bottom border, padding or height to stop it. So the margin spaces the rows on
// screen while sitting outside the wrapper's border box, which is the only
// thing getBoundingClientRect reports. Measured: a folded window row is 32px
// tall and 40px apart from the next one.
//
// MEASURED AMONG ITS SIBLINGS, not against the next row in the list, and that
// distinction is load-bearing. The `tabs` scope is a FLAT list of every tab in
// the window, so two consecutive ROWS need not be consecutive in the LAYOUT:
// between the last tab before a group and that group's first member sits the
// group's band header. Reading the next row's top there swallows 32px of chrome
// belonging to neither row, and the held tab reports a 66px footprint instead
// of its own 34 -- measured, and four times worse than the bug this fixes.
//
// Siblings cannot lie that way: whatever sits between two of them is margin.
//
// Read from the layout rather than the stylesheet, because the value is
// per-list and not reliably predictable from the CSS: windows sit 8px apart,
// items 2px, and tabs within a group 0px.
function footprintOf(
  el: HTMLElement | null,
  container: HTMLElement | null,
  height: number
): number {
  if (!el) return height;

  // A wrapper that exists only to hold this row IS the row as far as the list
  // is concerned -- a loose tab is a `tabs` row inside an `items` row, and the
  // margin that spaces it lives on the outer one. Never climb past the drag
  // area itself, which would start measuring the list against its neighbours.
  //
  // Nor ONTO any box that holds a list's rows (KAN-132): another area's
  // container, or a box a list marked with `markRowContainer`. Both lists here
  // now span every window, so neither one's container sits anywhere near its
  // rows -- and in a window holding a single item, everything between that item
  // and the window's own block has exactly one child, which is the shape this
  // climb is looking for. Stopping below such a box leaves the measurement on
  // the same element it was on while every window had lists of its own.
  let box: HTMLElement = el;
  while (
    box !== container &&
    box.parentElement &&
    box.parentElement !== container &&
    !isRowContainer(box.parentElement) &&
    box.parentElement.children.length === 1
  ) {
    box = box.parentElement;
  }

  const self = box.getBoundingClientRect();

  // ITS OWN MARGINS, not the gap to whatever sits beside it (KAN-167).
  //
  // This used to measure the distance to the next sibling, and with collapsing
  // margins that attributes the NEIGHBOUR's margin to this row. Measured in the
  // popup: loose tabs sit flush, 0px apart, but a group's band carries
  // `margin: 2px 0`, so the tab above one reported 34 for a row occupying 32 --
  // and every element the preview displaced then moved 2px too far.
  //
  // Read from the element the margin is actually ON. Every row here is a
  // wrapper this file owns holding a block the list owns, and that block's
  // margin COLLAPSES THROUGH the wrapper -- the wrapper sets no border, padding
  // or height to stop it. So the margin spaces the rows on screen while
  // reporting 0 on the box `getBoundingClientRect` measures, which is exactly
  // why the sibling distance was used in the first place.
  //
  // Windows are unaffected: a window row is 32 tall and carries its own
  // `margin-bottom: 8px`, so it comes out at 40 either way. The two
  // measurements diverge only where a NEIGHBOUR contributes margin, and the
  // band is the only neighbour in this app that does.
  // THE BOTTOM MARGIN ONLY. A footprint is a top-to-next-top pitch, so the gap
  // it includes is the one BELOW the row -- and adjacent margins collapse, so
  // adding the top one as well double-counts a gap this row shares with its
  // neighbour. Measured: two group bands 2px apart each carry `margin: 2px 0`,
  // and summing both put every item 2px out.
  const inner = box.firstElementChild ?? box;
  const own =
    self.height + (parseFloat(getComputedStyle(inner).marginBottom) || 0);

  // A row with no height at all has not been laid out yet; fall back rather
  // than hand the preview a zero it would shift everything by.
  return own > 0 ? own : height;
}

// Two sets of shifts on one list, added key by key (KAN-169). A slot the held
// row passes AND a removed band closes up past moves by both; a slot in one set
// only keeps that one; absent stays absent, as every shifts object promises.
function summed(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, shift] of Object.entries(b)) {
    out[key] = (out[key] ?? 0) + shift;
  }
  return out;
}

export const RowDragArea: React.FC<RowDragAreaProps> = ({
  rowIds,
  scope,
  onMove,
  handleSelector,
  dragKind = 'tab',
  dropsAcrossWindows = false,
  clampDropToEnds = false,
  restoreScrollIfNoDrop = false,
  resolveDrop,
  onDropTargetChange,
  fixedRowSelector,
  landsBesideFixedRow,
  fixedRowsRemovedBy,
  disabled = false,
  children,
}) => {
  const parent = useContext(DragContext);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<DragState | null>(null);

  // Everything the live drag needs, kept in a ref so the window listeners are
  // installed once rather than re-bound on every pointermove.
  const live = useRef<{
    rowId: string;
    startX: number;
    startY: number;
    started: boolean;
    rects: Rect[];
    fromIndex: number;
    // The held row's border box, which is what the containment guard's slack is
    // measured in, and its footprint, which is what the preview shifts by. Two
    // names because they are two different quantities (KAN-163).
    height: number;
    footprint: number;
    lastX: number;
    lastY: number;
    // Auto-scroll (KAN-152). The scrolling ancestor, and where it stood when
    // the rects were measured -- every index comparison is done in the list's
    // own content space so that scrolling cannot invalidate it.
    scroller: HTMLElement | null;
    startScrollTop: number;
    // The scroll at pointer-down, before any collapse -- what a drag that
    // commits nothing puts back (KAN-157). Not startScrollTop, which is
    // deliberately re-read AFTER the collapse (KAN-154) and so describes the
    // folded list, not the one the user was looking at.
    scrollTopAtPress: number;
    maxScroll: number;
    // Where a release still counts as a drop on this list, when the list has
    // opted in (KAN-155). Null otherwise, and then only the rows count.
    pane: HTMLElement | null;
    // The held row's element while a started drag holds it (KAN-160). Kept
    // here so finish clears the element the marker was set on.
    heldEl: HTMLElement | null;
    // The saved-window block the held row sits in, read at drag start
    // (KAN-132): where a release outside every window can still land, and
    // whether this list's rows sit in windows at all. Null for a row in no
    // window.
    heldWindow: HTMLElement | null;
    // The last target resolveDrop named, so the list hears only about changes
    // rather than once per pointer move (KAN-164).
    dropTarget: string | undefined;
    // The list AS DRAWN -- every row plus every fixed row the list declared,
    // in layout order (KAN-166). The preview runs here rather than over `rects`
    // because a drop can move a row past a title row without changing its row
    // index, and in a list of rows alone that has no expression.
    //
    // A second array rather than a wider `rects`, so the DROP path -- which is
    // correct, and speaks row indices the reducers share -- is untouched.
    slots: Slot[];
    // Row index -> slot index, and fixed-row key -> slot index. Both are the
    // same translation and neither is derivable from the other once a fixed row
    // sits between two rows.
    slotOfRow: number[];
    slotOfFixed: Map<string, number>;
    // Where each saved window this list spans ENDS, in content space, measured
    // with the rows (KAN-132). A row landing past another window's last row --
    // or in a collapsed one, which draws no rows -- is placed there.
    windowBottoms: Map<string, number>;
    // The saved windows this list spans, in render order (KAN-184). What the
    // preview needs to know to move the ones BETWEEN the source and the
    // destination, so the destination can make room.
    windowOrder: string[];
    // Where each window's list CONTENT starts, in content space (KAN-169): what
    // stands in for the slot above a span that leads its window. Keyed like
    // the slots, so a list with no windows has one entry under undefined.
    listTops: Map<string | undefined, number>;
  } | null>(null);

  // The auto-scroll frame, cancelled on drop. A ref rather than state: it is
  // never rendered, and re-rendering every frame is the thing this is trying to
  // avoid making worse.
  const scrollFrame = useRef(0);

  // Chrome synthesizes a `click` after `mouseup`, aimed at whatever the pointer
  // released over -- which is the held row, because it tracks the pointer. Left
  // alone it runs the row's onClick: for a tab that opens the tab, and for a
  // window it opens the whole window's worth of tabs.
  //
  // A timestamp rather than an add/remove-listener dance: the click arrives in
  // the same input sequence as the pointerup that arms this, and a listener
  // removed on a timer can race that sequence in either direction. Spending the
  // window on the first swallowed click is what stops the NEXT ordinary click
  // being eaten too.
  const suppressClickUntil = useRef(0);

  const register = useCallback((rowId: string, el: HTMLElement | null) => {
    if (el) rows.current.set(rowId, el);
    else rows.current.delete(rowId);
  }, []);

  const begin = useCallback(
    (
      rowId: string,
      clientX: number,
      clientY: number,
      target: EventTarget | null
    ) => {
      if (disabled) return;

      // A press in a text field starts a selection, not a drag (KAN-162). The
      // window rename field sits inside the window's handle, and selecting
      // its text used to fold every window and move the window.
      if (isInEditableField(target)) return;

      // The handle must be inside THIS row, not merely an ancestor of the
      // press. `closest` walks all the way to the document, so without the
      // containment check a handle anywhere above the area would qualify every
      // press in it -- which is the nesting bug this prop exists to prevent,
      // reintroduced one level higher up.
      if (handleSelector) {
        const el = rows.current.get(rowId);
        const handle =
          target instanceof Element ? target.closest(handleSelector) : null;
        if (!handle || !el?.contains(handle)) return;
      }

      // Resolved HERE, at pointer-down, and not at activation -- because by
      // activation the held row already carries a transform, and a transform
      // EXTENDS the scrollable overflow area. Measured in the real popup: while
      // auto-scrolling, scrollHeight climbed 820 -> 1393 in step with scrollTop,
      // so a limit read live was a limit that ran away from the pointer as fast
      // as it approached it. jsdom cannot show this at all -- scrollHeight there
      // is whatever a test stubs -- so it is pinned by a test that makes the
      // stub grow.
      const el = rows.current.get(rowId) ?? null;
      const scroller = scrollableAncestor(el);

      live.current = {
        rowId,
        startX: clientX,
        startY: clientY,
        started: false,
        rects: [],
        fromIndex: rowIds.indexOf(rowId),
        height: 0,
        footprint: 0,
        lastX: clientX,
        lastY: clientY,
        scroller,
        startScrollTop: scroller?.scrollTop ?? 0,
        scrollTopAtPress: scroller?.scrollTop ?? 0,
        maxScroll: scroller
          ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          : 0,
        pane: clampDropToEnds ? paneOf(el) : null,
        heldEl: null,
        heldWindow: null,
        dropTarget: undefined,
        slots: [],
        slotOfRow: [],
        slotOfFixed: new Map(),
        windowOrder: [],
        windowBottoms: new Map(),
        listTops: new Map(),
      };
    },
    [rowIds, handleSelector, disabled, clampDropToEnds]
  );

  useEffect(() => {
    // Everything below works in the list's CONTENT space -- viewport y plus the
    // scroller's current scrollTop. The rects are measured once (see below) and
    // auto-scroll moves the list under them, so a viewport comparison would go
    // stale the instant the list scrolled: rows would appear to drift past the
    // pointer and the drop would land somewhere the user never pointed.
    //
    // With no scrolling ancestor scrollTop is 0 and this is exactly the
    // arithmetic that was here before.
    const contentY = (l: NonNullable<typeof live.current>, clientY: number) =>
      clientY + (l.scroller?.scrollTop ?? 0);

    // The saved-window block the pointer is over, or null (KAN-132).
    //
    // Only for a list whose rows sit IN windows AND whose drops may cross from
    // one to another. The window list's container holds every block too, but its
    // rows wrap blocks rather than sitting in one, and a window drag that asked
    // this would land at index 0 of a block none of its rows were counted in.
    // A list that has not opted in answers every question in the held row's own
    // window, which is what refuses a release over any other one.
    //
    // Read from the live layout, unlike the rows: a tab drag moves rows by
    // transform and never a window's own box, so every block still stands where
    // it stood at drag start, and a viewport hit test needs no scroll term.
    //
    // A forced layout read: windowBlockAt calls getBoundingClientRect on every
    // window block in the pane. Call ONCE per move and thread the answer down
    // -- landingOf and dropRoot both used to call this themselves, and
    // onMoveEvent's drop-target notifier called it a third time through
    // dropRoot, which on a 20-window session was ~60 forced layout reads per
    // pointermove before counting judgeDrop's own call at drop time.
    //
    // NOT CACHED ACROSS MOVES, even keyed on pointer position: auto-scroll
    // moves every block's box without moving the pointer, so a position-keyed
    // cache would answer a stale block on the frame after the list scrolls.
    // Every call site that runs once per move computes this fresh, right at
    // its own top, and passes the one answer down -- see update() and
    // autoScroll() below, and judgeDrop further down, which computes its own
    // for a different reason (see judgeDrop's own comment).
    const blockUnderPointer = (l: NonNullable<typeof live.current>) =>
      l.heldWindow && dropsAcrossWindows
        ? windowBlockAt(containerRef.current, l.lastX, l.lastY)
        : null;

    // One window's rows, in list order. Undefined picks out the rows in no
    // window, which in a list with no windows is all of them.
    const rowsIn = (
      l: NonNullable<typeof live.current>,
      windowId: string | undefined
    ) => l.rects.filter((r) => r.windowId === windowId);

    // What resolveDrop is handed: the block the pointer is over (KAN-132). A
    // band belongs to exactly one window, so a wider search could only answer
    // with a band this release does not land in. Outside every block it is the
    // held row's own -- the one window still in play, see landingOf -- and for
    // a list with no windows, the list itself.
    //
    // Takes `block` rather than calling blockUnderPointer itself: every caller
    // in this move's own flow already has one, computed once for that flow --
    // see the perf note on blockUnderPointer above. Passing it in is what
    // keeps this a second READ of that answer, not a second forced layout.
    const dropRoot = (
      l: NonNullable<typeof live.current>,
      block: HTMLElement | null
    ) => block ?? l.heldWindow ?? containerRef.current;

    // The slot a landing IN THE HELD ROW'S OWN WINDOW names, in the list AS
    // DRAWN, which spans the whole pane (KAN-132). The landing index counts one
    // window's rows, so it becomes a row of the full list through that window's
    // rows before it can name a slot. A refused release names the slot the row
    // left.
    //
    // Every index a release in its own window can name HAS a row -- the held
    // row itself is one of them -- so the fallback is unreachable. It answers
    // "nothing moves" rather than a window-local index read as a pane-wide one
    // (KAN-131). A landing in another window is not a slot the row moves to at
    // all; see insertionSlotOf.
    const slotOfLanding = (
      l: NonNullable<typeof live.current>,
      landing: Landing | undefined,
      from: number
    ): number => {
      if (landing === undefined) return from;
      const row = rowsIn(l, landing.windowId)[landing.index];
      return row === undefined ? from : l.slotOfRow[row.index] ?? row.index;
    };

    // Where a row landing in ANOTHER window is inserted (KAN-132): the slot it
    // goes in front of, in the list as drawn -- or `l.slots.length`, past every
    // slot, when it lands after that window's last row or in a window with no
    // rows drawn at all.
    //
    // A title row the list names wins over the row index, for the same reason
    // as within one window (KAN-166, KAN-174): "before row t" is ambiguous when
    // a title row sits in front of t.
    const insertionSlotOf = (
      l: NonNullable<typeof live.current>,
      landing: Landing,
      beside: { fixedRowId: string; side: LandingSide } | undefined
    ): number => {
      const fixed =
        beside === undefined ? undefined : l.slotOfFixed.get(beside.fixedRowId);
      if (beside !== undefined && fixed !== undefined) {
        return beside.side === 'before' ? fixed : fixed + 1;
      }
      const row = rowsIn(l, landing.windowId)[landing.index];
      return row === undefined
        ? l.slots.length
        : l.slotOfRow[row.index] ?? l.slots.length;
    };

    // Where a release at the pointer's current position lands, or undefined
    // where it would be refused.
    //
    // THE ONE DECISION, used by both the preview and the release (KAN-158).
    // The preview used to count midpoints on its own, so it always named some
    // index -- and where the release was refused (above, below or beside the
    // pane; a tab outside its window) it opened a gap and promised a move that
    // never came. Two copies of this rule are two chances to disagree.
    //
    // Reads the pane's box, so like everything here it must run while the
    // drag's own layout stands -- see judgeDrop.
    //
    // Takes `block` rather than calling blockUnderPointer itself -- see the
    // perf note there. The caller computed it once, for this same move.
    const landingOf = (
      l: NonNullable<typeof live.current>,
      block: HTMLElement | null
    ): Landing | undefined => {
      // Content space, matching how the rects were measured. Using the raw
      // viewport y here would misjudge both the containment test and the
      // landing index by however far the list had auto-scrolled.
      const dropY = contentY(l, l.lastY);

      // WHICH WINDOW (KAN-132): the one whose block the pointer is over. Its
      // header counts, and so does a collapsed window, which draws no rows at
      // all -- both land at index 0, because none of their midpoints is passed.
      //
      // Outside every block, only the held row's own window is still in play,
      // and only near its own rows: the guard below. That is the forgiveness
      // "drag it to the end" has always had -- an overshoot past a window's
      // last row lands in the gap under its block, and still means "last".
      // Anything further out names no window, and is refused.
      const windowId = (block ?? l.heldWindow)?.dataset.dropWindowId;
      const rows = rowsIn(l, windowId);

      // A release in the empty space below (or above) the rows, but still
      // inside the pane being dragged in. The index needs no special case: it
      // counts the midpoints the pointer has passed, so a release under every
      // row already comes out as the last index, and one above them as 0.
      //
      // l.pane is only set when the list OPTED IN, never on the geometry alone
      // -- for the tab list this same release means "dragged out of this
      // window", and committing it is the KAN-132 defect isInsideList was
      // written to stop. The tab list spans every window in the pane, so the
      // pane is no boundary for it at all.
      const paneBox = l.pane?.getBoundingClientRect();
      const releasedInPane =
        paneBox !== undefined &&
        l.lastY >= paneBox.top &&
        l.lastY <= paneBox.bottom &&
        l.lastX >= paneBox.left &&
        l.lastX <= paneBox.right;

      // The list's own extent, taken from the DRAWN list so a group's title
      // row counts as part of it (KAN-173). `slots` is already ordered by
      // measured top, so the landing window's first entry is whatever that
      // window's list starts with -- not the first window's, whose chrome sits
      // above every other window's rows.
      const drawnTop = l.slots.find((s) => s.windowId === windowId)?.top;
      if (
        block === null &&
        !isInsideList(rows, dropY, l.height / 2, drawnTop) &&
        !releasedInPane
      ) {
        return undefined;
      }

      // The count of rows whose midpoint the pointer has passed IS the index
      // the row lands at, because that count indexes the list with the held
      // row already lifted out of it.
      //
      // Rows of unequal height need no special case: the held row displaces
      // every row between its old and new slots by ITS OWN height, whatever
      // theirs are, and the landing index comes from each row's measured
      // midpoint rather than from any assumed row size.
      //
      // Counted over the landing window's rows alone, because that is the list
      // the index is applied to. Counted across the pane it would include
      // every row of every window above (KAN-131, one level up).
      const others = rows.filter((r) => r.id !== l.rowId);
      return { windowId, index: others.filter((r) => dropY > r.mid).length };
    };

    // Returns the element resolveDrop was asked against, so a caller that
    // needs to ask it something else at this SAME pointer position (the
    // drop-target notifier in onMoveEvent) can reuse the answer instead of
    // re-running the hit test -- see the perf note on blockUnderPointer.
    const update = (
      l: NonNullable<typeof live.current>
    ): HTMLElement | null => {
      // Computed ONCE for this whole move and threaded down, not re-read by
      // landingOf and dropRoot separately -- see the perf note on
      // blockUnderPointer above.
      const block = blockUnderPointer(l);

      // Where the release would be refused, preview the row going back where
      // it came from: no row steps aside, and its own slot stays open.
      //
      // REFUSED AND "LANDS WHERE IT STARTED" ARE NOT THE SAME STATE, and this
      // used to conflate them (KAN-172). Falling back to the from-index was
      // enough while a preview was built from an index alone, because to ===
      // from then says "nothing moves". It stopped being enough once a drop
      // could change a row's GROUP without changing its index: for a tab that
      // is already its group's first member, the fallback still satisfies the
      // leaving rule, so a refused release drew a full membership-change
      // preview and promised a move that never came.
      const landing = landingOf(l, block);

      // What a release HERE would land ON, asked once and spent twice (KAN-164,
      // KAN-166): the list is told when the answer changes, and the landing
      // placeholder is corrected by whatever that target implies.
      //
      // Asked on every move rather than only at the drop, because a drop can
      // change more than an index -- a tab released inside a group's band joins
      // that group -- and the user cannot see a rule that is only consulted
      // once the pointer is already up.
      const root = dropRoot(l, block);
      const target = resolveDrop?.(root, l.lastX, l.lastY)?.bandId;

      // The whole preview in the list AS DRAWN, decided once (KAN-166). The
      // shifts, the frame and the landing slot all come off this one pair of
      // indices, so there is no second derivation to disagree with the first --
      // which is exactly how the slot came to be drawn on an occupied row.
      const from = l.slotOfRow[l.fromIndex] ?? l.fromIndex;
      const beside =
        landing === undefined
          ? undefined
          : landsBesideFixedRow?.(
              l.rowId,
              landing.index,
              target,
              landing.windowId
            );
      // What the drop REMOVES (KAN-169): a span of fixed rows the list says
      // will not survive this release -- a group's title row and tail marker,
      // while its only member is held outside it. Nothing the shifts below can
      // express on their own: they move slots, and every slot they know about
      // was measured at drag start and survives to the drop. So the span is
      // named, the room it gives back is measured between the slots either
      // side of it, and every slot below closes up by that much ON TOP OF
      // whatever the held row's own move does to it. Two events, summed.
      //
      // Asked only where a release lands: a refused one changes nothing, and
      // must not preview a group vanishing (the KAN-172 lesson, again).
      const removed =
        landing === undefined
          ? undefined
          : fixedRowsRemovedBy?.(
              l.rowId,
              landing.index,
              target,
              landing.windowId
            );
      const spanFirst =
        removed === undefined ? undefined : l.slotOfFixed.get(removed.first);
      const spanLast =
        removed === undefined ? undefined : l.slotOfFixed.get(removed.last);
      const span =
        removed !== undefined &&
        spanFirst !== undefined &&
        spanLast !== undefined &&
        spanFirst <= spanLast
          ? {
              first: spanFirst,
              last: spanLast,
              freed: freedByRemoving(
                l.slots,
                spanFirst,
                spanLast,
                l.height,
                removed.gapKept,
                l.listTops.get(l.slots[spanFirst]?.windowId)
              ),
              // Every fixed row in the span, for whoever draws them. The one
              // ROW in it is the held one, which is not drawn there anyway.
              keys: l.slots
                .slice(spanFirst, spanLast + 1)
                .map((s) => s.key)
                .filter((key) => l.slotOfFixed.has(key)),
            }
          : undefined;
      const closingUp =
        span === undefined ? {} : removalShifts(l.slots, span.last, span.freed);

      let shifts: Record<string, number>;
      let landingDelta: number;
      // Which WINDOW BLOCKS move, so the destination has somewhere to put the
      // row (KAN-184). Empty for every landing inside one window.
      let windowShifts: Record<string, number> = {};
      if (
        landing !== undefined &&
        landing.windowId !== undefined &&
        landing.windowId !== l.heldWindow?.dataset.dropWindowId
      ) {
        // Into ANOTHER window: each window previewed in its own frame, not one
        // range across both (KAN-132) -- see previewShiftsAcross for what the
        // single range drew.
        const at = insertionSlotOf(l, landing, beside);
        // The span is in the SOURCE window, so only its shifts change: the
        // landing is measured in the destination's frame and the source keeps
        // its box (KAN-184), the freed room showing as a gap inside it.
        shifts = summed(
          previewShiftsAcross(l.slots, from, landing.windowId, at, l.footprint),
          closingUp
        );
        landingDelta = landingDeltaAcross(
          l.slots,
          from,
          landing.windowId,
          at,
          l.windowBottoms.get(landing.windowId)
        );
        windowShifts = windowShiftsAcross(
          l.windowOrder,
          landing.windowId,
          l.footprint
        );
      } else {
        const fixedSlot =
          beside === undefined
            ? undefined
            : l.slotOfFixed.get(beside.fixedRowId);
        const to =
          fixedSlot === undefined || beside === undefined
            ? slotOfLanding(l, landing, from)
            : slotLandingBeside(from, fixedSlot, beside.side);
        shifts = summed(
          previewShifts(l.slots, from, to, l.footprint),
          closingUp
        );
        landingDelta = landingDeltaOf(l.slots, from, to);
        // Landing BELOW the removed span, the row settles among rows that have
        // closed up, and its slot comes up with them. Landing above it or at
        // its head, nothing between the row and its slot has moved.
        if (span !== undefined && to > span.last) landingDelta -= span.freed;
      }

      setDrag({
        rowId: l.rowId,
        // The scroll delta is part of the travel. The held row lives inside the
        // scroller, so scrolling moves it with the content; without this term
        // it would slide out from under the pointer by exactly the distance
        // auto-scroll just travelled.
        offset:
          l.lastY - l.startY + (l.scroller?.scrollTop ?? 0) - l.startScrollTop,
        footprint: l.footprint,
        shifts,
        landingDelta,
        windowShifts,
        // The held row and its landing slot are drawn INSIDE blocks that this
        // same preview may have moved (KAN-184), so both have to be told by how
        // much or they ride along: the row would stop tracking the pointer, and
        // the ghost would sit a row away from the landing it names.
        heldWindowShift:
          windowShifts[l.heldWindow?.dataset.dropWindowId ?? ''] ?? 0,
        landingWindowShift: windowShifts[landing?.windowId ?? ''] ?? 0,
        removedFixedRows: span?.keys ?? [],
      });

      return root;
    };

    // Drag the list along when the pointer is held near its edge, so a target
    // that is off screen can be reached at all (KAN-152). Speed ramps with how
    // deep into the edge zone the pointer is, which makes a small correction
    // near the boundary possible and a long haul quick.
    const step = (l: NonNullable<typeof live.current>): number => {
      const box = l.scroller?.getBoundingClientRect();
      if (!l.scroller || !box) return 0;

      // Capped to a third of the viewport, because a fixed 48px zone at each
      // end OVERLAPS in a short list -- in a 90px pane the two zones cover 96px,
      // so every position counts as an edge and the list scrolls no matter where
      // the pointer is. Found by the control test, which is what a control is
      // for. A third each leaves a third in the middle that never scrolls.
      const zone = Math.min(EDGE_ZONE_PX, box.height / 3);

      const intoTop = zone - (l.lastY - box.top);
      const intoBottom = zone - (box.bottom - l.lastY);
      const depth = Math.max(intoTop, intoBottom);
      if (depth <= 0) return 0;

      const speed = Math.min(depth / zone, 1) * MAX_SCROLL_PX_PER_FRAME;
      return intoTop > intoBottom ? -speed : speed;
    };

    const autoScroll = () => {
      const l = live.current;
      scrollFrame.current = 0;
      if (!l?.started || !l.scroller) return;

      const delta = step(l);
      if (delta !== 0) {
        const before = l.scroller.scrollTop;
        // Clamped against the limit captured at pointer-down, never a live one:
        // but depending on that makes correctness a property of the environment
        // instead of this function -- and the value is read back below to decide
        // whether to keep going, so an unclamped write would report progress
        // that never happened.
        l.scroller.scrollTop = Math.max(
          0,
          Math.min(l.maxScroll, before + delta)
        );
        // Only keep going while the list is actually moving. At either end it
        // is not, and a loop that cannot make progress is a spinning frame.
        if (l.scroller.scrollTop !== before) update(l);
      }
      scrollFrame.current = requestAnimationFrame(autoScroll);
    };

    const onMoveEvent = (e: PointerEvent) => {
      const l = live.current;
      if (!l) return;
      l.lastX = e.clientX;
      l.lastY = e.clientY;

      if (!l.started) {
        const travelled = Math.hypot(
          e.clientX - l.startX,
          e.clientY - l.startY
        );
        // Below the threshold this is still a click, and the row's own
        // onClick must be allowed to fire untouched.
        if (travelled < ACTIVATION_DISTANCE_PX) return;

        // BEFORE the measurement, not after (KAN-153). A window drag collapses
        // every tab list via CSS, which changes every row's height -- and this
        // writes the attribute straight to the DOM, so the
        // getBoundingClientRect calls below flush style and layout and read the
        // COLLAPSED boxes. Measure first and every midpoint would describe a
        // layout that no longer exists.
        l.started = true;
        setDragging(true, dragKind);

        // Which row is held, for rules that apply to it alone (KAN-160: a
        // group drag compresses only the held group). Written straight to the
        // DOM like the kind above, and before the measurement below, so the
        // rects read the compressed layout. React never touches it, so a
        // re-render cannot drop it (KAN-159).
        l.heldEl = rows.current.get(l.rowId) ?? null;
        l.heldEl?.setAttribute('data-drag-held', '');
        l.heldWindow = windowOf(l.heldEl);

        // RE-READ AFTER THE COLLAPSE, and this is load-bearing (KAN-154).
        // Folding the windows shut can make the list shorter than its viewport,
        // and the browser then clamps scrollTop to fit -- measured, 404 -> 0 on
        // a five-window session scrolled to the bottom. The value captured at
        // pointer-down describes a scroll position that no longer exists, and
        // using it puts every midpoint AND the held row's offset out by exactly
        // that much: the row lands 316px above the pane, off screen, and the
        // drop index is computed against a list nobody is pointing at.
        //
        // Reading it here, after the attribute is set and the rects below have
        // forced layout, is what keeps the measurement and the pointer in one
        // consistent frame.
        l.startScrollTop = l.scroller?.scrollTop ?? 0;

        // Measured once, at the moment the drag actually starts: reading rects
        // on every move would report positions already displaced by the shifts
        // this drag is applying.
        //
        // Stored in content space, so auto-scrolling the list afterwards leaves
        // them valid rather than silently wrong.
        l.rects = rowIds.map((id, index) => {
          const el = rows.current.get(id);
          const r = el?.getBoundingClientRect();
          return {
            id,
            index,
            mid: r ? r.top + r.height / 2 + l.startScrollTop : 0,
            height: r?.height ?? 0,
            top: r ? r.top + l.startScrollTop : 0,
            windowId: windowOf(el)?.dataset.dropWindowId,
          };
        });
        // The list AS DRAWN (KAN-166): the rows, plus whatever fixed parts the
        // list declared, ordered by where they actually sit. Ordered by
        // measured top rather than by document order, because a fixed row is
        // rendered inside the thing it labels and its position in the markup
        // says nothing about its position on screen.
        const fixed = fixedRowSelector
          ? [
              ...(containerRef.current?.querySelectorAll<HTMLElement>(
                fixedRowSelector
              ) ?? []),
            ].flatMap((el) => {
              const key = el.dataset.fixedRowId;
              if (key === undefined) return [];
              const box = el.getBoundingClientRect();
              return [
                {
                  key,
                  top: box.top + l.startScrollTop,
                  // A group's tail marker measures 0 here, by design: it holds a
                  // place in this list without occupying any (KAN-176).
                  height: box.height,
                  windowId: windowOf(el)?.dataset.dropWindowId,
                },
              ];
            })
          : [];

        l.slots = [
          ...l.rects.map((r) => ({
            key: r.id,
            top: r.top,
            height: r.height,
            windowId: r.windowId,
          })),
          ...fixed,
        ].sort((a, b) => a.top - b.top);

        l.slotOfRow = [];
        l.slotOfFixed = new Map();
        const rowAt = new Map(l.rects.map((r) => [r.id, r.index]));
        l.slots.forEach((slot, index) => {
          const row = rowAt.get(slot.key);
          if (row !== undefined) l.slotOfRow[row] = index;
          else l.slotOfFixed.set(slot.key, index);
        });

        // Where each window ends, for a list whose rows sit in windows
        // (KAN-132). In the same frame as the rects, like everything above.
        l.windowBottoms = new Map();
        l.windowOrder = [];
        if (l.heldWindow) {
          for (const block of windowBlocksIn(containerRef.current)) {
            const id = block.dataset.dropWindowId;
            if (id === undefined) continue;
            l.windowOrder.push(id);
            l.windowBottoms.set(
              id,
              block.getBoundingClientRect().bottom + l.startScrollTop
            );
          }
        }

        // Where each window's rows START (KAN-169), for a removed span with no
        // slot above it: the content top of the box that holds that window's
        // rows, which is where the row below the span will sit once the span is
        // gone. The box is the nearest marked row container above the row --
        // or this area's own container, for a list drawn in one box -- read
        // once per window, in the same frame as everything above.
        l.listTops = new Map();
        for (const r of l.rects) {
          if (l.listTops.has(r.windowId)) continue;
          let el = rows.current.get(r.id) ?? null;
          while (
            el?.parentElement &&
            el.parentElement !== containerRef.current &&
            !isRowContainer(el.parentElement)
          ) {
            el = el.parentElement;
          }
          const holder = el?.parentElement;
          if (!holder) continue;
          const style = getComputedStyle(holder);
          l.listTops.set(
            r.windowId,
            holder.getBoundingClientRect().top +
              (parseFloat(style.paddingTop) || 0) +
              (parseFloat(style.borderTopWidth) || 0) +
              l.startScrollTop
          );
        }

        l.height = l.rects[l.fromIndex]?.height ?? 0;
        // Measured in the same frame as the rects above, and from the element
        // rather than from them -- see footprintOf on why the list order cannot
        // answer this.
        l.footprint = footprintOf(
          rows.current.get(l.rowId) ?? null,
          containerRef.current,
          l.height
        );

        // Re-read now that the list may have collapsed: the limit captured at
        // pointer-down described the expanded content, and auto-scrolling to
        // THAT would run far past the end of a list a third the size.
        if (l.scroller) {
          l.maxScroll = Math.max(
            0,
            l.scroller.scrollHeight - l.scroller.clientHeight
          );
        }

        // Re-anchor the grab. Collapsing moves every row, so the row being held
        // is no longer under the pointer where it was picked up -- without this
        // it jumps away by however much the rows above it shrank. Pinning the
        // pointer to the row's CENTRE rather than preserving the original grab
        // offset is deliberate: that offset was measured against a row that no
        // longer exists at that height, and a centred row is what the drop
        // arithmetic assumes anyway.
        const held = l.rects[l.fromIndex];
        if (held) l.startY = held.mid - l.startScrollTop;
        if (!scrollFrame.current) {
          scrollFrame.current = requestAnimationFrame(autoScroll);
        }
      }

      // The root update() resolved its own resolveDrop call against, for this
      // SAME pointer position -- reused below rather than hit-tested again,
      // see the perf note on blockUnderPointer.
      const root = update(l);

      if (onDropTargetChange && resolveDrop) {
        // Compared and forwarded as `.bandId`, not the object resolveDrop
        // returned: a fresh object compares unequal on every pointermove even
        // when nothing the caller cares about changed, which would fire
        // onDropTargetChange every move instead of only on a real change
        // (KAN-164's whole point). onDropTargetChange's contract is
        // unchanged by KAN-132 -- it still names a band, not a window.
        const t = resolveDrop(root, l.lastX, l.lastY).bandId;
        if (t !== l.dropTarget) {
          l.dropTarget = t;
          // The whole list, not the window the target is in: the mark being
          // replaced may sit in the window the pointer has just left (KAN-132).
          onDropTargetChange(t, containerRef.current);
        }
      }
    };

    // Where a release lands, or undefined for a release this list refuses.
    //
    // MUST RUN BEFORE THE DRAG KIND IS UNPUBLISHED (KAN-156). The rows were
    // measured in the drag's own layout -- folded, for a window drag -- and the
    // drop has to be judged in that same layout. Unpublishing unfolds every
    // window, and the first layout read after it (scrollTop, below) forces the
    // unfolded layout: measured on a twenty-window session, scrollTop read 385
    // folded and 1200 straight after unpublishing, and a window released
    // mid-pane landed last. The mirror of the rule at activation, where the
    // kind is published BEFORE measuring.
    //
    // The landing decision itself is landingOf, shared with the preview, so
    // what the user was shown and what happens cannot differ (KAN-158).
    const judgeDrop = (
      l: NonNullable<typeof live.current>
    ):
      | {
          toIndex: number;
          dropTargetId: string | undefined;
          toWindowId: string | undefined;
        }
      | undefined => {
      // Computed HERE, not threaded in from a previous move's update() or
      // autoScroll() call: KAN-156 requires this hit test run while the
      // drag's own (possibly folded) layout still stands, and the drag kind
      // is unpublished before finish() reaches here in some orderings. A
      // value computed on an earlier move could describe a layout that no
      // longer exists by the time this runs.
      const block = blockUnderPointer(l);
      const landing = landingOf(l, block);
      if (landing === undefined) return undefined;
      return {
        // Window-local, in the window named beside it -- see Landing.
        toIndex: landing.index,
        toWindowId: landing.windowId,
        dropTargetId: resolveDrop?.(dropRoot(l, block), l.lastX, l.lastY)
          ?.bandId,
      };
    };

    const finish = (commit: boolean) => {
      const l = live.current;
      live.current = null;
      setDrag(null);
      // Redundant today and kept anyway: autoScroll already bails when
      // live.current is null, which this line has just made true, so the loop
      // would stop on its own (verified -- removing this fails nothing). It
      // stays because "the drag is over" and "the frame is cancelled" should not
      // be two facts a reader has to connect, and because one stray frame after
      // a drop is a cost nobody would think to look for.
      if (scrollFrame.current) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = 0;
      }
      if (!l) return;
      // Judged first, while the drag's layout still stands -- see judgeDrop.
      const drop = commit && l.started ? judgeDrop(l) : undefined;
      setDragging(false);
      l.heldEl?.removeAttribute('data-drag-held');
      // Whatever was marked stops being a target the moment the drag ends --
      // committed, refused or cancelled alike (KAN-164).
      if (l.dropTarget !== undefined)
        onDropTargetChange?.(undefined, containerRef.current);
      // Below the threshold this was a click, not a drag, and the row's own
      // handler must run untouched.
      if (!l.started) return;

      // Armed for a real drag whether it committed, was refused, or was
      // cancelled with Esc: in every case the user was dragging, and in none
      // did they ask for the row they were holding to open.
      suppressClickUntil.current = performance.now() + 400;

      if (drop) {
        // The window is passed only by a list whose rows sit in windows. Every
        // other list is called exactly as it always was, and never learns the
        // argument exists.
        //
        // THE TWO-ARITY CALLS ARE LOAD-BEARING, not a shorter way to write the
        // same thing with the 4th argument left `undefined`:
        // dragSurvivesRerender.test.tsx:107 asserts
        // `toHaveBeenCalledWith('a', 1, undefined)`, which a trailing explicit
        // `undefined` 4th argument fails -- vitest's mock matcher checks
        // argument COUNT too. Do not collapse this to one call spread over
        // both branches.
        if (drop.toWindowId === undefined) {
          onMove(l.rowId, drop.toIndex, drop.dropTargetId);
        } else {
          onMove(l.rowId, drop.toIndex, drop.dropTargetId, drop.toWindowId);
        }

        // Follow the row you just dropped (KAN-155).
        //
        // Releasing ENDS the collapse, so the list springs back from a third of
        // its height to all of it -- and a row dropped at the bottom of the
        // folded list is then far below the fold. The user placed it
        // deliberately and cannot see where it went, which is KAN-143's
        // complaint arriving by a different route.
        //
        // On the next frame, because the reorder has to be committed and laid
        // out before there is anything to scroll to; and `block: 'nearest'`
        // so a row already on screen is left exactly where it is.
        //
        // Only on a COMMITTED drop, which is the only case with a new place to
        // show. A drag that commits nothing is the branch below.
        const dropped = l.rowId;
        requestAnimationFrame(() => {
          rows.current.get(dropped)?.scrollIntoView({ block: 'nearest' });
        });
      } else if (restoreScrollIfNoDrop && l.scroller) {
        // Put the view back (KAN-157). For a window drag "nothing happened" is
        // not the same as "leave the scroll alone": the collapse already
        // clamped it, and unfolding does not give it back -- measured, five
        // windows scrolled to 300 ended at 0 with the held window off screen.
        //
        // Synchronous, and after setDragging(false) above: the kind is
        // unpublished, so this write lays out against the UNFOLDED list and
        // its full scroll range, which is the only one 300 fits in.
        l.scroller.scrollTop = l.scrollTopAtPress;
      }
    };

    const onUp = () => finish(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    const onCancel = () => finish(false);
    // Capture, on window: this has to run before React's root delegation gets
    // the chance to dispatch the row's onClick.
    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() >= suppressClickUntil.current) return;
      suppressClickUntil.current = 0;
      e.preventDefault();
      e.stopPropagation();
    };
    // A new press disarms it (KAN-177). The suppression is for ONE click: the
    // one Chrome synthesizes for the drag's own release, which follows that
    // pointerup with no press in between (measured in click-after-drag.spec.ts).
    //
    // A drag that COMMITS gets no such click -- React moves the row inside the
    // pointerup handler -- so, judged by the clock alone, the suppression stayed
    // armed and ate the user's next click wherever it landed: very often Undo.
    // Every click the user makes after a drag starts with a pointerdown of its
    // own, and that is what tells the two apart; not the time, and not where
    // the click lands.
    //
    // Capture, on window, for the same reason as onClickCapture: nothing a
    // press reaches first can stop it from getting here.
    const onPointerDownCapture = () => {
      suppressClickUntil.current = 0;
    };

    window.addEventListener('pointermove', onMoveEvent);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => {
      window.removeEventListener('pointermove', onMoveEvent);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
      // NOT setDragging(false) -- see the unmount effect below (KAN-159). This
      // cleanup runs on every change to the deps as well as on unmount, and a
      // drag in flight must survive the listeners being re-bound.
    };
  }, [
    rowIds,
    onMove,
    resolveDrop,
    onDropTargetChange,
    fixedRowSelector,
    landsBesideFixedRow,
    fixedRowsRemovedBy,
    dragKind,
    dropsAcrossWindows,
    restoreScrollIfNoDrop,
  ]);

  // A drag interrupted by UNMOUNT must not leave the document stuck in a drag.
  //
  // Its own effect with no deps, so it runs on unmount and nothing else
  // (KAN-159). This used to live in the listener effect's cleanup above, which
  // React also runs whenever rowIds, onMove or the rest change identity -- and
  // a store update that rebuilds the session data (a sync landing) changes them
  // for every list at once. Measured in the popup: the flag vanished mid-drag
  // with the row still held, the windows unfolded under the pointer, and the
  // drag carried on against rects measured in the folded layout.
  //
  // And only when THIS area owns a started drag. The flag is document-wide,
  // so clearing it unconditionally let a tab list unmounting -- its window
  // deleted, say -- end a window drag somewhere else.
  useEffect(
    () => () => {
      const l = live.current;
      live.current = null;
      if (scrollFrame.current) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = 0;
      }
      if (l?.started) setDragging(false);
    },
    []
  );

  // Known to every footprint's climb as a box holding a list's rows -- see
  // footprintOf. The element is the same for the life of the area.
  useEffect(() => {
    markRowContainer(containerRef.current);
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({ register, begin, drag }),
    [register, begin, drag]
  );

  const scopes = useMemo<DragScopes>(
    () => ({
      nearest: ctx,
      byScope:
        scope === undefined
          ? parent?.byScope ?? {}
          : { ...parent?.byScope, [scope]: ctx },
    }),
    [ctx, parent, scope]
  );

  return (
    <div ref={containerRef}>
      <DragContext.Provider value={scopes}>{children}</DragContext.Provider>
    </div>
  );
};

// A row no longer needs to know WHERE it is (KAN-166). It used to take its own
// index and re-derive its shift from the drag's index range; the area now works
// the whole preview out once and reports each element's shift by id, so the
// index was a second copy of the list's order living on every row.
export const DraggableRow: React.FC<DraggableRowProps> = ({
  rowId,
  scope,
  children,
}) => {
  const scopes = useContext(DragContext);
  // A name no enclosing list declared resolves to nothing, and the row is
  // inert. Falling back to the nearest list would drag it in a list that does
  // not contain it.
  const ctx =
    (scope === undefined ? scopes?.nearest : scopes?.byScope[scope]) ?? null;
  const drag = ctx?.drag ?? null;

  const held = drag?.rowId === rowId;
  // The held row tracks the pointer; every other row is told where to be by the
  // area, which works it out once for the whole list (KAN-166). This used to
  // re-derive it from an index range here, and a group's frame re-derived it a
  // third time -- three copies of one rule, which is how they came to disagree.
  // The held row tracks the POINTER, and its own window's block may have been
  // translated to make room elsewhere (KAN-184) -- so it gives that back, or it
  // rides along and drifts a whole row off the cursor.
  const translate = !drag
    ? 0
    : held
      ? drag.offset - drag.heldWindowShift
      : drag.shifts[rowId] ?? 0;

  return (
    <div
      // The area's own handle for this row, and the only stable way to address
      // a draggable node from a test or the devtools -- the node is otherwise
      // an unmarked wrapper div.
      data-drag-row-id={rowId}
      ref={(el) => ctx?.register(rowId, el)}
      onPointerDown={(e) => {
        // Left button only. Which PART of the row may start a drag is the
        // area's rule, not this component's, so the press is reported with its
        // target and the area decides.
        if (e.button !== 0) return;
        ctx?.begin(rowId, e.clientX, e.clientY, e.target);
      }}
      style={{
        transform: translate ? `translateY(${translate}px)` : undefined,
        // The held row must track the pointer exactly; only the rows moving
        // aside are animated.
        transition: held ? 'none' : 'transform 0.18s ease',
        boxShadow: held ? '0 2px 8px rgba(0,0,0,0.35)' : undefined,
        zIndex: held ? 1 : undefined,
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      {/* KAN-166. The slot this row will land in.
          A child of the held row that counter-transforms out of the wrapper's
          own translate and on to the landing offset, which pins it to the gap
          that has opened -- without touching the transform channel this node
          owns, and without any other component learning about the drag.
          The landing slot is real empty space, so nothing can sit on top of it;
          a marker at the ORIGIN cannot say that, because the row behind the
          held one steps straight into that slot.
          currentColor keeps it legible in every theme without this file
          growing a dependency on the theme it otherwise has no use for. */}
      {held && (
        <div
          aria-hidden="true"
          data-drag-landing-slot=""
          style={{
            position: 'absolute',
            // LONGHANDS, never the `inset` shorthand (KAN-183). React diffs
            // style objects property by property: with `inset` here and a
            // `bottom` override below, switching back to the box left `bottom`
            // removed rather than restored -- the slot collapsed to its
            // borders, 2px, and STAYED that way for the rest of the drag.
            // Measured: `top: 0px; right: 0px; left: 0px` and no bottom at
            // all. Both branches must write the same property names.
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            // The landing is measured in the pre-drag layout, and the two ends
            // of that measurement now sit in blocks that may have moved apart
            // (KAN-184): the slot is drawn inside the HELD row's block, while
            // the distance it carries points into the LANDING's. The difference
            // is what neither end knows on its own.
            transform: `translateY(${
              drag.landingDelta -
              translate +
              drag.landingWindowShift -
              drag.heldWindowShift
            }px)`,
            pointerEvents: 'none',
            border: '1.5px dashed currentColor',
            borderRadius: '4px',
            // As visible as it is DISTINGUISHABLE from the row being dragged.
            //
            // The held row tracks the pointer continuously while the slot jumps
            // between discrete positions, so the two pass close to each other
            // every time the landing index changes -- and drawn at full
            // strength there, the slot reads as an outline around the dragged
            // row rather than as the gap it will drop into.
            //
            // Faded rather than hidden past a threshold: the separation does
            // not ease through zero, it JUMPS at each index change (measured,
            // -64px straight to -10px), so any cutoff blinks. Scaling by the
            // row's own footprint keeps it continuous and needs no number of
            // its own -- one row's worth of travel is exactly the distance at
            // which the two boxes stop overlapping.
            opacity:
              SLOT_OPACITY *
              Math.min(
                1,
                drag.footprint > 0
                  ? Math.abs(drag.landingDelta - translate) / drag.footprint
                  : 1
              ),
          }}
        />
      )}
      {children}
    </div>
  );
};
