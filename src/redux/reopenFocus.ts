import type { Reopened } from '../utils/functions/reopen';

// Where focus goes after Reopen (KAN-311, O8c): the reopened tab's × or the
// reopened window's chevron. Chrome answers before Open now has re-read, so
// the row is not on screen yet. Reopen records it here, and the Open now
// pane focuses it once it is listed. Outside Redux, like the offer itself:
// a live tab or window id is never stored.
export const REOPEN_FOCUS_MS = 3000;

let pending: Reopened | null = null;
let expiry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Replaces any earlier one. If the row has not appeared within
// REOPEN_FOCUS_MS it is forgotten, and focus stays where it is.
export function expectReopenedRow(target: Reopened): void {
  if (expiry !== null) clearTimeout(expiry);
  pending = target;
  expiry = setTimeout(clearReopenFocus, REOPEN_FOCUS_MS);
  notify();
}

// The row still waiting for focus, or null. A plain read: the same object on
// every call until it changes, as useSyncExternalStore needs.
export function pendingReopenFocus(): Reopened | null {
  return pending;
}

// The row has focus, or its time ran out: nothing is waiting any more.
export function clearReopenFocus(): void {
  if (expiry !== null) {
    clearTimeout(expiry);
    expiry = null;
  }
  if (pending === null) return;
  pending = null;
  notify();
}

export function subscribeReopenFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
