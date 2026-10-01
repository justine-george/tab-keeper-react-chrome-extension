// KAN-350. A drag that has left the saved session it started in.
//
// A drag belongs to the RowDragArea it started in, and an area's unmount ends
// its drag. Resting on a session row swaps the detail pane, which unmounts the
// source area mid-drag -- so a drag that reaches the session list (a carry
// receiver, KAN-352) is handed here, to something that outlives every area, and is CARRIED until the
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
  // `title` is the window's stored title, which is what its header shows,
  // and may be empty: the header then shows nothing.
  | { kind: 'window'; title: string; tabCount: number };

// What a drag area hands over when its drag reaches a carry receiver.
export interface CarryOut {
  carried: CarriedRef;
  card: CarryCard;
}

// Who is driving the carry: the CarryLayer (the pointer is outside every area
// that can take it), or an area that adopted it as its own drag (RowDragArea's
// adoptRowId).
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
// What puts the source's view back if the carry is cancelled: the scroll a
// window or group drag's fold clamped (KAN-157). Kept beside the carry rather
// than in it, because it is not something any reader of the carry needs.
let restoreOnCancel: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

// Starts carrying, driven by the layer. Replaces any carry already on. An
// adopted drag that leaves its pane again does NOT come through here: it
// hands the same carry back with setCarryOwner('layer'), so the source's card
// and restoreOnCancel stay as they are (KAN-350, RowDragArea's handOff).
//
// `restoreOnCancel` runs once, on the frame after a CANCELLED carry ends --
// see endCarry -- and never after a committed one.
export function startCarry(
  carried: CarriedRef,
  card: CarryCard,
  x: number,
  y: number,
  onCancel?: () => void
): void {
  carry = { carried, card, x, y, owner: 'layer' };
  restoreOnCancel = onCancel ?? null;
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

// How a carry ended. 'committed': something took it and moved the item, so
// the view is where the move left it. 'cancelled': nothing moved (Esc, a
// release nothing took, pointercancel, the item gone), so the source's view
// is put back as a refused drag puts it back.
export type CarryOutcome = 'committed' | 'cancelled';

// Ends the carry: unpublishes the drag kind, ends the drag hold (which applies
// every change held meanwhile), then tells subscribers. Nothing moves here --
// a receiver that commits does so before calling this.
//
// A no-op when nothing is carried, and that is load-bearing: the hold and the
// kind are document-wide, and ending them for a carry that is not on would end
// a drag some area is still running.
//
// A CANCELLED carry's restoreOnCancel runs on the next frame, not here. The
// engine puts a refused drag's scroll back synchronously, straight after
// unpublishing, because its row never left the list. A carried row did: the
// source draws without it until React re-renders from the notify below, and
// that render is not synchronous with this call (an external-store update
// from a native listener is flushed in a microtask). Written now, the scroll
// would be clamped to the list with the row still missing. By the next frame
// the render has committed, and the frame has not been painted yet, so the
// list never shows at the wrong scroll.
export function endCarry(outcome: CarryOutcome): void {
  if (carry === null) return;
  outcomes.set(carry.carried, outcome);
  carry = null;
  const restore = restoreOnCancel;
  restoreOnCancel = null;
  try {
    // The engine's order at a drop: unpublish, then apply held changes.
    setDragging(false);
    endDragHold();
  } finally {
    notify();
    if (outcome === 'cancelled' && restore !== null) {
      requestAnimationFrame(restore);
    }
  }
}

// How each carry ended, by what it carried: the ref is one object for the
// whole carry (moveCarry and setCarryOwner keep it). Weak, so a carry long
// over is not kept.
const outcomes = new WeakMap<CarriedRef, CarryOutcome>();

// How the carry of `carried` ended: undefined while it is still on, or if it
// never was. For a caller that let something else end it -- an adopted drag
// whose list committed the move -- and has to know which way it went.
export function carryEndedAs(carried: CarriedRef): CarryOutcome | undefined {
  return outcomes.get(carried);
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
