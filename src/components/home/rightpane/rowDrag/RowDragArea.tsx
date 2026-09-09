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
  } | null>(null);

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
      };
    },
    [rowIds, handleSelector, disabled]
  );

  useEffect(() => {
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

        // Measured once, at the moment the drag actually starts: reading rects
        // on every move would report positions already displaced by the shifts
        // this drag is applying.
        l.rects = rowIds.map((id, index) => {
          const el = rows.current.get(id);
          const r = el?.getBoundingClientRect();
          return {
            id,
            index,
            mid: r ? r.top + r.height / 2 : 0,
            height: r?.height ?? 0,
          };
        });
        l.height = l.rects[l.fromIndex]?.height ?? 0;
        l.started = true;
        setDragging(true);
      }

      const others = l.rects.filter((r) => r.id !== l.rowId);
      // The count of rows whose midpoint the pointer has passed IS the index
      // the row lands at, because that count indexes the list with the held
      // row already lifted out of it.
      //
      // Rows of unequal height need no special case: the held row displaces
      // every row between its old and new slots by ITS OWN height, whatever
      // theirs are, and the landing index comes from each row's measured
      // midpoint rather than from any assumed row size.
      const toIndex = others.filter((r) => e.clientY > r.mid).length;

      setDrag({
        rowId: l.rowId,
        fromIndex: l.fromIndex,
        toIndex,
        offset: e.clientY - l.startY,
        height: l.height,
      });
    };

    const finish = (commit: boolean) => {
      const l = live.current;
      live.current = null;
      setDrag(null);
      if (!l) return;
      setDragging(false);
      // Below the threshold this was a click, not a drag, and the row's own
      // handler must run untouched.
      if (!l.started) return;

      // Armed for a real drag whether it committed or was cancelled with Esc:
      // in both cases the user was dragging, and in neither did they ask for
      // the row to open.
      suppressClickUntil.current = performance.now() + 400;

      // Armed above, checked here: a drop this area refuses is still a drag the
      // user performed, and they did not ask to open the row they were holding.
      if (commit && isInsideList(l.rects, l.lastY, l.height / 2)) {
        const others = l.rects.filter((r) => r.id !== l.rowId);
        const toIndex = others.filter((r) => l.lastY > r.mid).length;
        const dropTargetId = resolveDrop?.(
          containerRef.current,
          l.lastX,
          l.lastY
        );
        onMove(l.rowId, toIndex, dropTargetId);
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
      // A drag interrupted by unmount must not leave the document stuck in
      // `grabbing`.
      setDragging(false);
    };
  }, [rowIds, onMove, resolveDrop]);

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
