import type { OpenNowDrop } from '../utils/functions/openNowMoves';

// The Open now drop ⌘Z / Ctrl+Z can undo (KAN-280 spec O11f, U1). Kept here,
// in memory and outside Redux, like reopenOfferStore: a drop names live
// Chrome tab ids that mean nothing after this page closes, so it is never
// stored or synced. Imports nothing from Redux, so the middleware, the offer
// thunk and the Open now hook can all reach it without an import cycle.
//
// ⌘Z undoes the most recent Tab Keeper action (ledger R23): an Open now drop
// that changed something, a Reopen offer shown, or a new saved-session
// undoable change -- an undo or redo step is none of them. Each takes the
// next number of one counter, so "the drop is the most recent" is a
// comparison: nothing has taken a number since it did.
let lastAction = 0;
let latestDrop: { action: number; drop: OpenNowDrop } | null = null;

// A Reopen offer shown, or a new saved-session undoable change. Any drop
// before it can no longer be undone.
export function noteTabKeeperAction(): void {
  lastAction += 1;
}

// A drop that changed something: the most recent action now, replacing any
// drop before it.
export function storeOpenNowDrop(drop: OpenNowDrop): void {
  lastAction += 1;
  latestDrop = { action: lastAction, drop };
}

// The drop ⌘Z undoes: the latest one, while no other action has come since.
// Taken once, and gone either way -- a drop's undo has no redo (ledger R5),
// and one another action came after can never be the most recent again.
export function takeOpenNowDrop(): OpenNowDrop | null {
  const latest = latestDrop;
  latestDrop = null;
  if (latest === null || latest.action !== lastAction) return null;
  return latest.drop;
}
