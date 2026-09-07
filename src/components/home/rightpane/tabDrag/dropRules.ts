// What a drag MEANS, kept apart from how it is driven.
//
// TabDragArea beside this file owns the pointer mechanics; this owns the rules
// those mechanics apply, so each can be read and changed without the other.
// `bandAt` in particular is the whole membership decision in one testable
// function.
import type { ReactNode } from 'react';

export const ACTIVATION_DISTANCE_PX = 5;

export interface TabDragAreaProps {
  // Flat, in render order. Index into this is what onMove's toIndex means.
  tabIds: string[];
  onMove: (tabId: string, toIndex: number, toChromeGroupId?: string) => void;
  children: ReactNode;
}

export interface DraggableTabProps {
  tabId: string;
  children: ReactNode;
}

// THE DROP RULE: the band decides. A tab released while the pointer is inside a
// group's band -- padding included, since getBoundingClientRect covers it --
// joins that group; anywhere else it lands ungrouped.
//
// Resolved from rects rather than from the engine's own collision result, so
// both prototypes answer this question identically. Bands are marked with
// data-band-id in WindowEntryContainer.
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

// `grabbing` goes on the document, not on the row. During a drag the pointer
// travels over other rows, gaps and bands, and a cursor scoped to the source
// element reverts the moment it leaves -- which reads as the drag letting go.
export function setBodyGrabbing(on: boolean): void {
  document.body.style.cursor = on ? 'grabbing' : '';
  // Without this the browser selects row text as the pointer sweeps the list.
  document.body.style.userSelect = on ? 'none' : '';
}
