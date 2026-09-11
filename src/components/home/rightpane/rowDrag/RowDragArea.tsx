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
  ACTIVATION_DISTANCE_PX,
  isInsideList,
  setDragging,
  type DraggableRowProps,
  type RowDragAreaProps,
} from './dropRules';

interface DragState {
  rowId: string;
  fromIndex: number;
  toIndex: number;
  // How far the held row has travelled from where it was picked up.
  offset: number;
  height: number;
}

interface Ctx {
  register: (rowId: string, el: HTMLElement | null) => void;
  begin: (
    rowId: string,
    clientX: number,
    clientY: number,
    target: EventTarget | null
  ) => void;
  drag: DragState | null;
}

const DragContext = React.createContext<Ctx | null>(null);

// How close to an edge the pointer must be for the list to start travelling,
// and how fast it goes at its deepest. 48px is roughly a row and a half here,
// which is wide enough to hit without aiming and narrow enough that ordinary
// dragging near the ends does not trigger it.
const EDGE_ZONE_PX = 48;
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
}

export const RowDragArea: React.FC<RowDragAreaProps> = ({
  rowIds,
  onMove,
  handleSelector,
  dragKind = 'tab',
  clampDropToEnds = false,
  restoreScrollIfNoDrop = false,
  resolveDrop,
  disabled = false,
  children,
}) => {
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
    height: number;
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
        lastX: clientX,
        lastY: clientY,
        scroller,
        startScrollTop: scroller?.scrollTop ?? 0,
        scrollTopAtPress: scroller?.scrollTop ?? 0,
        maxScroll: scroller
          ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          : 0,
        pane: clampDropToEnds ? paneOf(el) : null,
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
    const landingIndex = (
      l: NonNullable<typeof live.current>
    ): number | undefined => {
      // Content space, matching how the rects were measured. Using the raw
      // viewport y here would misjudge both the containment test and the
      // landing index by however far the list had auto-scrolled.
      const dropY = contentY(l, l.lastY);

      // A release in the empty space below (or above) the rows, but still
      // inside the pane being dragged in. The index needs no special case: it
      // counts the midpoints the pointer has passed, so a release under every
      // row already comes out as the last index, and one above them as 0.
      //
      // l.pane is only set when the list OPTED IN, never on the geometry alone
      // -- for a nested tab list this same release means "dragged out of this
      // window", and committing it is the KAN-132 defect isInsideList was
      // written to stop.
      const paneBox = l.pane?.getBoundingClientRect();
      const releasedInPane =
        paneBox !== undefined &&
        l.lastY >= paneBox.top &&
        l.lastY <= paneBox.bottom &&
        l.lastX >= paneBox.left &&
        l.lastX <= paneBox.right;

      if (!isInsideList(l.rects, dropY, l.height / 2) && !releasedInPane) {
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
      const others = l.rects.filter((r) => r.id !== l.rowId);
      return others.filter((r) => dropY > r.mid).length;
    };

    const update = (l: NonNullable<typeof live.current>) => {
      // Where the release would be refused, preview the row going back where
      // it came from: no row steps aside, and its own slot stays open.
      const toIndex = landingIndex(l) ?? l.fromIndex;

      setDrag({
        rowId: l.rowId,
        fromIndex: l.fromIndex,
        toIndex,
        // The scroll delta is part of the travel. The held row lives inside the
        // scroller, so scrolling moves it with the content; without this term
        // it would slide out from under the pointer by exactly the distance
        // auto-scroll just travelled.
        offset:
          l.lastY - l.startY + (l.scroller?.scrollTop ?? 0) - l.startScrollTop,
        height: l.height,
      });
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
          };
        });
        l.height = l.rects[l.fromIndex]?.height ?? 0;

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

      update(l);
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
    // The landing decision itself is landingIndex, shared with the preview, so
    // what the user was shown and what happens cannot differ (KAN-158).
    const judgeDrop = (
      l: NonNullable<typeof live.current>
    ): { toIndex: number; dropTargetId: string | undefined } | undefined => {
      const toIndex = landingIndex(l);
      if (toIndex === undefined) return undefined;
      return {
        toIndex,
        dropTargetId: resolveDrop?.(containerRef.current, l.lastX, l.lastY),
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
      // Below the threshold this was a click, not a drag, and the row's own
      // handler must run untouched.
      if (!l.started) return;

      // Armed for a real drag whether it committed, was refused, or was
      // cancelled with Esc: in every case the user was dragging, and in none
      // did they ask for the row they were holding to open.
      suppressClickUntil.current = performance.now() + 400;

      if (drop) {
        onMove(l.rowId, drop.toIndex, drop.dropTargetId);

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

    window.addEventListener('pointermove', onMoveEvent);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('pointermove', onMoveEvent);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClickCapture, true);
      // NOT setDragging(false) -- see the unmount effect below (KAN-159). This
      // cleanup runs on every change to the deps as well as on unmount, and a
      // drag in flight must survive the listeners being re-bound.
    };
  }, [rowIds, onMove, resolveDrop, dragKind, restoreScrollIfNoDrop]);

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

  const ctx = useMemo<Ctx>(
    () => ({ register, begin, drag }),
    [register, begin, drag]
  );

  return (
    <div ref={containerRef}>
      <DragContext.Provider value={ctx}>{children}</DragContext.Provider>
    </div>
  );
};

export const DraggableRow: React.FC<DraggableRowProps & { index: number }> = ({
  rowId,
  index,
  children,
}) => {
  const ctx = useContext(DragContext);
  const drag = ctx?.drag ?? null;

  let translate = 0;
  const held = drag?.rowId === rowId;

  if (drag) {
    if (held) {
      translate = drag.offset;
    } else if (drag.toIndex > drag.fromIndex) {
      // Dragging down: everything it has passed moves up one slot.
      if (index > drag.fromIndex && index <= drag.toIndex)
        translate = -drag.height;
    } else if (drag.toIndex < drag.fromIndex) {
      if (index >= drag.toIndex && index < drag.fromIndex)
        translate = drag.height;
    }
  }

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
      {children}
    </div>
  );
};
