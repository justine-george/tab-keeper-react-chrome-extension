// What a drag MEANS, kept apart from how it is driven.
//
// RowDragArea beside this file owns the pointer mechanics; this owns the rules
// those mechanics apply, so each can be read and changed without the other.
// `bandAt` in particular is the whole membership decision in one testable
// function.
import type { ReactNode } from 'react';

export const ACTIVATION_DISTANCE_PX = 5;

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

export interface RowDragAreaProps {
  // Flat, in render order. Index into this is what onMove's toIndex means.
  rowIds: string[];
  onMove: (rowId: string, toIndex: number, dropTargetId?: string) => void;
  // A CSS selector for the part of a row that starts a drag. Omitted, the whole
  // row does.
  //
  // This is what makes nesting safe. A window's draggable node wraps its header
  // AND its tabs, so without a handle every tab drag would begin a window drag
  // underneath it. The two areas need no other coordination: only the one whose
  // `begin` runs owns the gesture.
  handleSelector?: string;
  resolveDrop?: ResolveDrop;
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

// `grabbing` goes on the document, not on the row. During a drag the pointer
// travels over other rows, gaps and bands, and a cursor scoped to the source
// element reverts the moment it leaves -- which reads as the drag letting go.
export function setBodyGrabbing(on: boolean): void {
  document.body.style.cursor = on ? 'grabbing' : '';
  // Without this the browser selects row text as the pointer sweeps the list.
  document.body.style.userSelect = on ? 'none' : '';
}
