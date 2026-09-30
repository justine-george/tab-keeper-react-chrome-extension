// KAN-350. A drag that has left the saved session it started in.
//
// A drag belongs to the RowDragArea it started in, and an area's unmount ends
// its drag. Resting on a session row swaps the detail pane, which unmounts the
// source area mid-drag -- so a drag that leaves its pane sideways is handed
// here, to something that outlives every area, and is CARRIED until the
// release.
//
// Module state, like dragHold.ts and for the same reasons: the drag engine is
// generic and renders in tests without a store, and "a pointer is carrying
// something" is not application data. What is carried is named by ids (the
// store stays the truth about it) plus a display snapshot for the card.
//
// THE HOLD AND THE KIND ARE INHERITED, NOT TAKEN. The engine starts a carry
// with its drag hold on and its drag kind published, and leaves both on
// (RowDragArea's hand-off). startCarry touches neither; endCarry ends both.
import { useSyncExternalStore } from 'react';

import type { CarriedRef } from './slices/tabContainerDataStateSlice';
import { endDragHold } from './dragHold';
import { setDragging } from '../components/home/rightpane/rowDrag/dropRules';

// What the card that follows the pointer shows (D1 A), snapshotted when the
// carry starts. One shape per kind, so a group always has its colour and a
// tab its favicon. Words are the card's to add: this holds data, not text.
export type CarryCard =
  | { kind: 'tab'; title: string; faviconUrl: string }
  // `title` is the group's own, and may be empty: an unnamed group.
  | { kind: 'group'; title: string; color: string; tabCount: number }
  // 1-based: the window's place in its session, "Window N".
  | { kind: 'window'; windowNumber: number; tabCount: number };

// What a drag area hands over when its drag leaves the pane sideways.
export interface CarryOut {
  carried: CarriedRef;
  card: CarryCard;
}

// Who is driving the carry: the CarryLayer (the pointer is outside every area
// that can take it), or an area that adopted it as its own drag (Task 5).
export type CarryOwner = 'layer' | 'area';

export interface Carry {
  carried: CarriedRef;
  card: CarryCard;
  // The pointer, in viewport px.
  x: number;
  y: number;
  owner: CarryOwner;
}

let carry: Carry | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

// Starts carrying, driven by the layer. Replaces any carry already on: an
// adopted drag that leaves its pane again hands back through here.
export function startCarry(
  carried: CarriedRef,
  card: CarryCard,
  x: number,
  y: number
): void {
  carry = { carried, card, x, y, owner: 'layer' };
  notify();
}

export function currentCarry(): Carry | null {
  return carry;
}

export function subscribeCarry(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setCarryOwner(owner: CarryOwner): void {
  if (carry === null || carry.owner === owner) return;
  carry = { ...carry, owner };
  notify();
}

// A new object for the new position, keeping `carried` and `card` as they
// were: a reader of `carried` alone (useCarried) is not re-rendered by a move.
export function moveCarry(x: number, y: number): void {
  if (carry === null) return;
  carry = { ...carry, x, y };
  notify();
}

// Ends the carry: unpublishes the drag kind, ends the drag hold (which applies
// every change held meanwhile), then tells subscribers. Nothing moves here --
// a receiver that commits does so before calling this.
//
// A no-op when nothing is carried, and that is load-bearing: the hold and the
// kind are document-wide, and ending them for a carry that is not on would end
// a drag some area is still running.
export function endCarry(): void {
  if (carry === null) return;
  carry = null;
  try {
    // The engine's order at a drop: unpublish, then apply held changes.
    setDragging(false);
    endDragHold();
  } finally {
    notify();
  }
}

export function useCarry(): Carry | null {
  return useSyncExternalStore(subscribeCarry, currentCarry);
}

// What is carried, and nothing that changes as the pointer moves: its
// identity holds for the whole carry, so a component reading only this does
// not re-render on every pointermove.
const currentCarried = (): CarriedRef | null => carry?.carried ?? null;
export function useCarried(): CarriedRef | null {
  return useSyncExternalStore(subscribeCarry, currentCarried);
}

// Ruling 2. Something that can take a release while the layer drives the
// carry (the session list, Task 4). The layer asks every receiver in
// registration order; the first whose `hit` is true owns the pointer:
//   hover -- each move while it owns it;
//   leave -- when it stops owning it: another receiver or none is hit, the
//            carry ends, or an area adopts the carry;
//   take  -- the release, while it owns it: commit, and say whether it did.
// The layer ends the carry after every release either way, so a receiver never
// has to (endCarry is a no-op if it did).
export interface CarryReceiver {
  hit(x: number, y: number): boolean;
  hover(x: number, y: number): void;
  leave(): void;
  take(): boolean;
}

const receivers: CarryReceiver[] = [];

export function registerCarryReceiver(r: CarryReceiver): () => void {
  receivers.push(r);
  return () => {
    const i = receivers.indexOf(r);
    if (i !== -1) receivers.splice(i, 1);
  };
}

// The first receiver, in registration order, that the point hits.
export function carryReceiverAt(x: number, y: number): CarryReceiver | null {
  return receivers.find((r) => r.hit(x, y)) ?? null;
}
