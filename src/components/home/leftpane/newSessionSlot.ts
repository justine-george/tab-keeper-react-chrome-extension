// KAN-394 N1 (revised 2026-10-07). The empty place the session list opens at
// its top while a carry rests on the save row's New session target: where the
// new session lands. Presentation only; nothing in the store moves until the
// release.
//
// The receiver (useNewSessionReceiver) writes it; the list
// (TabGroupEntryContainer) draws it. Read through useSyncExternalStore, so a
// write from a native pointer event is rendered before the next paint, and a
// fill made beside the move that makes the session lands in that move's commit.
import { useSyncExternalStore } from 'react';

// closed: at rest. open: the list slid down one row, the place drawn.
// filled: the new session's row took the place, so the list stands still.
export type NewSessionSlot = 'closed' | 'open' | 'filled';

let slot: NewSessionSlot = 'closed';
const listeners = new Set<() => void>();

function set(next: NewSessionSlot): void {
  if (slot === next) return;
  slot = next;
  for (const listener of [...listeners]) listener();
}

export function openNewSessionSlot(): void {
  set('open');
}

// Slides back. A no-op unless open, so the leave that follows a fill keeps it.
export function closeNewSessionSlot(): void {
  if (slot === 'open') set('closed');
}

// Call after the new session is in the store, in the same task.
export function fillNewSessionSlot(): void {
  if (slot === 'open') set('filled');
}

// At rest again once the filled frame is painted: the list is already still.
export function settleNewSessionSlot(): void {
  if (slot === 'filled') set('closed');
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useNewSessionSlot(): NewSessionSlot {
  return useSyncExternalStore(subscribe, () => slot);
}

// The Divider under every row but the last (common/Divider: a 1px border).
const DIVIDER_PX = 1;

// How far the list moves when a row goes in on top: the distance between its
// first two rows, or, for one, its height and the divider it then gains. A
// difference of two rects, so a transform already on the column cancels out.
export function newSessionPitch(column: HTMLElement): number {
  const [first, second] = column.querySelectorAll('[data-drag-row-id]');
  if (first === undefined) return 0;
  const top = first.getBoundingClientRect();
  if (second === undefined) return top.height + DIVIDER_PX;
  return second.getBoundingClientRect().top - top.top;
}

// The y translation a transform puts on `el` now, mid-transition included;
// 0 for none, or for any value that is not a matrix.
export function translateYOf(el: Element): number {
  const t = getComputedStyle(el).transform;
  const m = /^matrix(3d)?\((.*)\)$/.exec(t);
  if (m === null) return 0;
  const values = m[2].split(',').map(Number);
  const y = m[1] === '3d' ? values[13] : values[5];
  return Number.isFinite(y) ? y : 0;
}
