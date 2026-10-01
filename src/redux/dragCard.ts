// KAN-354. The card a saved-list drag shows at the pointer while it is still
// a drag in its own list, before (or without) becoming a carry.
//
// Module state, like carry.ts and for the same reasons: the drag engine is
// generic and renders in tests without a store, and "a card follows the
// pointer" is not application data. The engine publishes here; CarryLayer
// draws it, and only draws it: a drag card never routes, takes or cancels
// anything.
import { useSyncExternalStore } from 'react';

import type { CarryCard } from './carry';

export interface DragCard {
  card: CarryCard;
  // The pointer, in viewport px.
  x: number;
  y: number;
}

let dragCard: DragCard | null = null;
// Who showed the card. Only that RowDragArea can move or hide it, so an area
// that is not dragging (or one that unmounts late) cannot take down the card
// of the area that is.
let dragCardOwner: symbol | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

// Shows the card, replacing any already on.
export function showDragCard(
  owner: symbol,
  card: CarryCard,
  x: number,
  y: number
): void {
  dragCard = { card, x, y };
  dragCardOwner = owner;
  notify();
}

// A no-op for another owner, and when the pointer has not moved: a reader is
// not re-rendered for nothing.
export function moveDragCard(owner: symbol, x: number, y: number): void {
  if (dragCard === null || owner !== dragCardOwner) return;
  if (dragCard.x === x && dragCard.y === y) return;
  dragCard = { ...dragCard, x, y };
  notify();
}

// A no-op for another owner, and when no card is on.
export function hideDragCard(owner: symbol): void {
  if (dragCard === null || owner !== dragCardOwner) return;
  dragCard = null;
  dragCardOwner = null;
  notify();
}

export function currentDragCard(): DragCard | null {
  return dragCard;
}

export function subscribeDragCard(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useDragCard(): DragCard | null {
  return useSyncExternalStore(subscribeDragCard, currentDragCard);
}
