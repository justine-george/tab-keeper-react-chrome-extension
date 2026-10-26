// KAN-350. A drag that has left the saved session it started in.
//
// A drag belongs to the RowDragArea it started in, and an area's unmount ends
// its drag. Resting on a session row swaps the detail pane, which unmounts the
// source area mid-drag -- so a drag that reaches the session list (a carry
// receiver, KAN-352) is handed here, to something that outlives every area,
// and is CARRIED until the release.
//
// Module state, like dragHold.ts and for the same reasons: the drag engine is
// generic and renders in tests without a store, and "a pointer is carrying
// something" is not application data. What is carried is a CarriedItem, its
// source and ids (the store stays the truth about it), plus a card snapshot.
//
// THE HOLD AND THE KIND ARE INHERITED, NOT TAKEN. The engine starts a carry
// with its drag hold on and its drag kind published, and leaves both on
// (RowDragArea's hand-off). startCarry touches neither; endCarry ends both.
//
// THE NEW WINDOW MARKER IS THE CARRY'S OWN (KAN-361 N1 B). A tab or group
// can be carried into a new window, from the moment it is carried until the
// carry ends, wherever it was picked up; a window cannot. So startCarry
// writes the marker from what is carried, and endCarry ends it.
import { useSyncExternalStore } from 'react';

import { pickOf, type CarriedItem } from './carriedItem';
import { endDragHold } from './dragHold';
import { foldBackSpringOpened } from './springOpenWindows';
import {
  setDragging,
  setDragNewSession,
  setDragNewWindow,
} from '../components/home/rightpane/rowDrag/dropRules';

// What the card that follows the pointer shows (D1 A), snapshotted when the
// carry starts. One shape per kind, so a group always has its colour and a
// tab its favicon. Words are the card's to add: this holds data, not text.
export type CarryCard =
  | { kind: 'tab'; title: string; faviconUrl: string }
  // `title` is the group's own, and may be empty: an unnamed group.
  | { kind: 'group'; title: string; color: string; tabCount: number }
  // `title` is the window's stored title, and may be empty: then `number`
  // names it, as its header does (windowLabel).
  | { kind: 'window'; title: string; number: number; tabCount: number };

// What a drag area hands over when its drag reaches a carry receiver.
export interface CarryOut {
  item: CarriedItem;
  card: CarryCard;
}

// Who is driving the carry: the CarryLayer (the pointer is outside every area
// that can take it), or an area that adopted it as its own drag (RowDragArea's
// adoptRowId).
export type CarryOwner = 'layer' | 'area';

export interface Carry {
  item: CarriedItem;
  card: CarryCard;
  // The pointer, in viewport px.
  x: number;
  y: number;
  owner: CarryOwner;
  // How far left of its row the press was (KAN-704), 0 for a press on it:
  // the list that adopts the carry reads bands as the pressed one did (KAN-706).
  pressOffRowX: number;
}

let carry: Carry | null = null;
// What puts the source's pane back at the press's scroll if the carry ends
// cancelled or copied (KAN-157, KAN-406). Kept beside the carry rather than
// in it, because it is not something any reader of the carry needs.
let restoreView: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

// Starts carrying, driven by the layer. Replaces any carry already on. An
// adopted drag that reaches the session list again does NOT come through
// here: it hands the same carry back with setCarryOwner('layer'), so the
// source's card and restoreView stay as they are (KAN-350, RowDragArea's
// handOff).
//
// `restoreView` runs once, on the frame after a carry ends cancelled or
// copied -- see endCarry -- and never after a committed one.
export function startCarry(
  item: CarriedItem,
  card: CarryCard,
  x: number,
  y: number,
  restore?: () => void,
  pressOffRowX = 0
): void {
  carry = { item, card, x, y, owner: 'layer', pressOffRowX };
  restoreView = restore ?? null;
  crossed = false;
  setDragNewWindow(pickOf(item).kind !== 'window');
  setDragNewSession(true);
  setCarrying(true);
  notify();
}

// KAN-394 (D18). On for a carry's whole life, and only then: a drag that may become one shows the save row's target too (setDragNewSession).
export function setCarrying(on: boolean): void {
  if (on) document.documentElement.setAttribute('data-carrying', '');
  else document.documentElement.removeAttribute('data-carrying');
}

// KAN-815. On while letting go here opens a copy in Chrome: a saved carry's
// card wears the + then (CarryLayer). Only while a carry is on; endCarry ends it.
let opens = false;

export function setCarryOpens(on: boolean): void {
  const next = on && carry !== null;
  if (next === opens) return;
  opens = next;
  document.documentElement.toggleAttribute('data-carry-opens', opens);
  notify();
}

const currentOpens = (): boolean => opens;
export function useCarryOpens(): boolean {
  return useSyncExternalStore(subscribeCarry, currentOpens);
}

// KAN-815, demo D3 (his pick). Whether this carry has been over Currently
// open. From then on a release there copies and nothing else takes it: only
// Currently open's receivers are asked, and the saved source keeps its row.
// Told by Currently open's pane on every move; cleared by a new carry and by
// the end.
let crossed = false;

export function noteCarryOverOpenNow(over: boolean): void {
  if (!over || crossed || carry === null) return;
  crossed = true;
  // Nothing on the saved side takes it now, so its targets go (demo D5).
  setDragNewWindow(false);
  setDragNewSession(false);
  notify();
}

export const carryCrossedIntoOpenNow = (): boolean => crossed;
export function useCarryCrossedIntoOpenNow(): boolean {
  return useSyncExternalStore(subscribeCarry, carryCrossedIntoOpenNow);
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

// A new object for the new position, keeping `item` and `card` as they
// were: a reader of `item` alone (useCarried) is not re-rendered by a move.
export function moveCarry(x: number, y: number): void {
  if (carry === null) return;
  carry = { ...carry, x, y };
  notify();
}

// How a carry ended. 'committed': something took it and moved the item, so
// the view is where the move left it. 'copied': Currently open took it and
// opened a copy (KAN-815); the item stayed, so the view is put back as on a
// cancel. 'cancelled': nothing moved (Esc, a release nothing took,
// pointercancel, the item gone), so the source's view is put back as a
// refused drag puts it back.
export type CarryOutcome = 'committed' | 'copied' | 'cancelled';

// Whether a carry ended so puts its source's view back: the item never left.
export const putsViewBack = (outcome: CarryOutcome | undefined): boolean =>
  outcome === 'cancelled' || outcome === 'copied';

// Ends the carry: unpublishes the carrying marker, the drag kind and the New
// window and New session markers, ends the drag hold (which applies every change held
// meanwhile), then tells subscribers. Nothing moves here -- a receiver that
// commits does so before calling this.
//
// A no-op when nothing is carried, and that is load-bearing: the hold and the
// kind are document-wide, and ending them for a carry that is not on would end
// a drag some area is still running.
//
// A cancelled or copied carry's restoreView runs on the next frame, not
// here. The engine puts a refused drag's scroll back synchronously, straight after
// unpublishing, because its row never left the list. A carried row did: the
// source draws without it until React re-renders from the notify below, and
// that render is not synchronous with this call (an external-store update
// from a native listener is flushed in a microtask). Written now, the scroll
// would be clamped to the list with the row still missing. By the next frame
// the render has committed, and the frame has not been painted yet, so the
// list never shows at the wrong scroll.
export function endCarry(outcome: CarryOutcome): void {
  if (carry === null) return;
  outcomes.set(carry.item, outcome);
  carry = null;
  crossed = false;
  const restore = restoreView;
  restoreView = null;
  try {
    // First, so nothing below that throws leaves the save row hidden.
    setDragNewSession(false);
    setCarrying(false);
    opens = false;
    document.documentElement.removeAttribute('data-carry-opens');
    // The engine's order at a drop: unpublish, then apply held changes.
    setDragging(false);
    setDragNewWindow(false);
    // KAN-379 Q2 A. The windows the gesture opened fold back at its end.
    foldBackSpringOpened();
    endDragHold();
  } finally {
    notify();
    if (putsViewBack(outcome) && restore !== null) {
      requestAnimationFrame(restore);
    }
  }
}

// How each carry ended, by what it carried: the item is one object for the
// whole carry (moveCarry and setCarryOwner keep it). Weak, so a carry long
// over is not kept.
const outcomes = new WeakMap<CarriedItem, CarryOutcome>();

// How the carry of `item` ended: undefined while it is still on, or if it
// never was. For a caller that let something else end it -- an adopted drag
// whose list committed the move -- and has to know which way it went.
export function carryEndedAs(item: CarriedItem): CarryOutcome | undefined {
  return outcomes.get(item);
}

export function useCarry(): Carry | null {
  return useSyncExternalStore(subscribeCarry, currentCarry);
}

// What is carried, and nothing that changes as the pointer moves: its
// identity holds for the whole carry, so a component reading only this does
// not re-render on every pointermove.
const currentCarried = (): CarriedItem | null => carry?.item ?? null;
export function useCarried(): CarriedItem | null {
  return useSyncExternalStore(subscribeCarry, currentCarried);
}

// Ruling 2. Something that can take a release while the layer drives the
// carry (the session list, Task 4). The layer asks every receiver in
// registration order; the first whose `hit` is true owns the pointer:
//   hit   -- whether the point is over it, from its box as it is now: a
//            layout read on every call. The layer asks it on every move,
//            because a receiver can move under a resting pointer while the
//            layer drives (a spring-open's peek re-lays the page out);
//   measureHit -- optional: the box read ONCE, now, and a test answering
//            from it. For a drag that asks on every move and through which
//            nothing moves the receiver (measureCarryReceivers). A receiver
//            without one is asked through `hit`;
//   hover -- each move while it owns it;
//   leave -- when it stops owning it: another receiver or none is hit, the
//            carry ends, or an area adopts the carry;
//   take  -- the release, while it owns it: commit, and say whether it did;
//   region -- optional: an area whose phantom row is inside it may adopt the
//            carry under it (RowDragArea's adopt); without one, none may.
// The layer ends the carry after every release either way, so a receiver never
// has to (endCarry is a no-op if it did): one that copied ends it 'copied'.
export interface CarryReceiver {
  hit(x: number, y: number): boolean;
  // KAN-815. The element it answers for, when it sits over a list that may
  // adopt the carry inside it (Open now's pane over its own lists).
  region?(): Element | null;
  measureHit?(): (x: number, y: number) => boolean;
  hover(x: number, y: number): void;
  leave(): void;
  take(): boolean;
  // KAN-815 (D3). Currently open's: the only kind asked once a carry crossed into it.
  inCurrentlyOpen?: boolean;
}

// Whether `r` may be asked now (D3).
const asked = (r: CarryReceiver) => !crossed || r.inCurrentlyOpen === true;

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
  return receivers.find((r) => asked(r) && r.hit(x, y)) ?? null;
}

// The receivers as they are NOW, for a caller that asks on every pointermove
// of one drag (RowDragArea, from the moment its drag starts): each box is
// read once, here, rather than once per move -- per-move layout reads are
// what the drag engine is built to avoid. Valid only while nothing moves the
// receivers, which nothing does in a drag the engine drives; the layer, which
// can see them move, asks carryReceiverAt instead. A receiver that has since
// unregistered is never named.
export function measureCarryReceivers(): (
  x: number,
  y: number
) => CarryReceiver | null {
  const measured = receivers.map((r) => ({
    r,
    hit: r.measureHit?.() ?? ((x: number, y: number) => r.hit(x, y)),
  }));
  return (x, y) =>
    measured.find(
      ({ r, hit }) => receivers.includes(r) && asked(r) && hit(x, y)
    )?.r ?? null;
}
