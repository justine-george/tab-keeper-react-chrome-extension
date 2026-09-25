import type { ClosedItem } from '../utils/functions/reopen';

// The one close the toast can still undo (KAN-280 O8a). Kept here, outside
// Redux, because a ClosedItem is a live snapshot that must never be stored or
// synced; Redux holds only the id naming it (toastReopenOfferId). This module
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
// newer offer (or a plain toast) replaced, returns null.
export function takeReopenOffer(id: number): ClosedItem | null {
  if (current === null || current.id !== id) return null;
  const { item } = current;
  current = null;
  return item;
}

// A plain toast replaces the Reopen toast, and the offer goes with it
// (KAN-280 O8a): no old close can be reopened from under another message.
export function dropReopenOffer(): void {
  current = null;
}
