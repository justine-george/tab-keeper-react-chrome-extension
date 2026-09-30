import type { ClosedItem } from '../utils/functions/reopen';

// The one close the toast can still undo (KAN-280 O8a). Kept here, outside
// Redux, because a ClosedItem is a live snapshot that must never be stored or
// synced; Redux holds only the id naming it, on the toast that offers it
// (globalState.toasts, KAN-349). This module
// imports nothing from Redux so the slice and the offer thunk can both use it
// without an import cycle.
let current: { id: number; item: ClosedItem } | null = null;
let nextId = 0;

// Rule 3: each close replaces the offer before it.
export function storeReopenOffer(item: ClosedItem): number {
  nextId += 1;
  current = { id: nextId, item };
  return nextId;
}

// Rule 4: taken once. A second call for the same id, or a call for an id a
// newer offer replaced or that was dropped, returns null.
export function takeReopenOffer(id: number): ClosedItem | null {
  if (current === null || current.id !== id) return null;
  const { item } = current;
  current = null;
  return item;
}

// The offer's toast has left (timed out, pushed out by newer toasts, or
// cleared), and the offer goes with it (KAN-280 O8a, KAN-349): no old close
// can be reopened once nothing on screen offers it. toastMiddleware calls
// this.
export function dropReopenOffer(): void {
  current = null;
}
