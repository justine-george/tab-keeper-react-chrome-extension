// KAN-394 N1 (revised). The session list's place for a new session; a sync-lane store, so a fill renders in the same commit as the move it follows.
import { useSyncExternalStore } from 'react';

// open: slid down a row, the place drawn; filled: the new row took the place, so nothing slides back.
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

// What a row going in on top moves the list by; a difference of rects, so the column's own transform cancels.
export function newSessionPitch(column: HTMLElement): number {
  const [first, second] = column.querySelectorAll('[data-drag-row-id]');
  if (first === undefined) return 0;
  const top = first.getBoundingClientRect();
  if (second === undefined) return top.height + DIVIDER_PX;
  return second.getBoundingClientRect().top - top.top;
}

// The y of `el`'s transform now, mid-transition included; 0 for none.
export function translateYOf(el: Element): number {
  const t = getComputedStyle(el).transform;
  const m = /^matrix(3d)?\((.*)\)$/.exec(t);
  if (m === null) return 0;
  const values = m[2].split(',').map(Number);
  const y = m[1] === '3d' ? values[13] : values[5];
  return Number.isFinite(y) ? y : 0;
}
