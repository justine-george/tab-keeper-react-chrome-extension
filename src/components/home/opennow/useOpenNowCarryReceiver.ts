// Open now's one carry receiver (KAN-280 Part F N4 A, KAN-815).
//
// - A live carry over Open now is the layer's, dims (N4 A) and takes nothing:
//   it is already open.
// - A saved tab or group: Open now's lists adopt it under this receiver
//   (its region is the pane), and land it at a slot or in the New window
//   block below the last window. Above the scroller -- the title, the
//   counts, the toolbar and the search row -- is the header's New window box
//   (spec builder call 2): the layer drives it there, and a release opens a
//   new window.
// - A saved window is never adopted: anywhere in the pane the block below the
//   last window lights, and a release opens it as a new window (r1 3 A).
// - A drag inside the pane is never handed here, Open now's own or an
//   adopted saved one: a held row inside the pane gets no hit. Over the
//   header an adopted one lands as a new window in its list.
//
// It also says whether a saved carry is over Currently open (the saved source
// then keeps its row, 1 A), from the pointer the layer moves the carry to.
import { useEffect, useRef, type RefObject } from 'react';
import { useDispatch } from 'react-redux';

import {
  carryCrossedIntoOpenNow,
  currentCarry,
  endCarry,
  noteCarryOverOpenNow,
  registerCarryReceiver,
  setCarryOpens,
  subscribeCarry,
  type Carry,
} from '../../../redux/carry';
import { pickOf } from '../../../redux/carriedItem';
import { openCarriedCopy } from '../../../redux/openCopy';
import type { AppDispatch } from '../../../redux/store';
import {
  OPEN_NOW_FIRST_TARGET,
  OPEN_NOW_LAST_TARGET,
} from '../rightpane/newWindowTarget';

interface Options {
  paneRef: RefObject<HTMLElement>;
  // The list's scroller: everything in the pane above it is the header.
  scrollerRef: RefObject<HTMLElement>;
  // Whether the saved carry on can open here: no search held, not the
  // tour's sample, still stored (OpenNowPane).
  takes: boolean;
  goToURLText: string;
}

const inBox = (b: DOMRect, x: number, y: number) =>
  x >= b.left && x < b.right && y >= b.top && y < b.bottom;

// KAN-352. Open now's resize grip lies over the pane's edge, and a saved drag
// let go on it is an ordinary move, never a carry.
const gripBox = (): DOMRect | null =>
  document.querySelector('[data-resize-grip]')?.getBoundingClientRect() ?? null;

// The pane's box, less the grip.
const inPaneBox = (pane: DOMRect, grip: DOMRect | null, x: number, y: number) =>
  inBox(pane, x, y) && (grip === null || !inBox(grip, x, y));

// A drawer sent away (N2 A) or still sliding in (KAN-820) answers nothing; read when asked.
const answersNothing = (pane: HTMLElement) =>
  pane.closest('[data-carry-away], [data-drawer-settling]') !== null;

// KAN-820 F2. Sprung and sliding in, the pointer is inside the drawer: out of it, the drawer is away.
const slidingIn = (pane: HTMLElement) =>
  pane.closest('[data-drawer-settling]:not([data-carry-away])') !== null;

// Written straight to the DOM, as the saved pane's targets are (markNewWindowTarget).
function light(pane: HTMLElement | null, target: string, on: boolean): void {
  pane
    ?.querySelector(`[data-new-window-target="${target}"]`)
    ?.toggleAttribute('data-landing', on);
}

// Justine's pick A: over Open now a live carry's card dims and loses its + (CarryLayer keys on this mark).
const markLiveOver = (on: boolean) =>
  document.documentElement.toggleAttribute('data-carry-over-open-now', on);

// D3: a saved carry crossed into Currently open, now outside it, where nothing takes it: its card dims too.
const markCrossedOut = (on: boolean) =>
  document.documentElement.toggleAttribute('data-carry-crossed-out', on);

const savedKind = (carry: Carry | null) =>
  carry?.item.source === 'saved' ? pickOf(carry.item).kind : null;

export function useOpenNowCarryReceiver({
  paneRef,
  scrollerRef,
  takes,
  goToURLText,
}: Options): void {
  const dispatch: AppDispatch = useDispatch();
  // Read when the receiver is asked, not when it registered.
  const latest = useRef({ takes, goToURLText, dispatch });
  useEffect(() => {
    latest.current = { takes, goToURLText, dispatch };
  }, [takes, goToURLText, dispatch]);

  useEffect(() => {
    const pane = () => paneRef.current;
    const headerBottom = (paneBox: DOMRect) =>
      scrollerRef.current?.getBoundingClientRect().top ?? paneBox.top;
    const pointerIn = (x: number, y: number): boolean => {
      const el = pane();
      return (
        el !== null &&
        !answersNothing(el) &&
        inPaneBox(el.getBoundingClientRect(), gripBox(), x, y)
      );
    };
    const inHeader = (x: number, y: number): boolean => {
      const el = pane();
      if (el === null || answersNothing(el)) return false;
      const b = el.getBoundingClientRect();
      return inBox(b, x, y) && y < headerBottom(b);
    };
    // Where the layer last hovered: what take() opens.
    let zone: 'none' | 'header' | 'window' = 'none';

    const unlightAll = () => {
      light(pane(), OPEN_NOW_FIRST_TARGET, false);
      light(pane(), OPEN_NOW_LAST_TARGET, false);
    };

    const unregister = registerCarryReceiver({
      inCurrentlyOpen: true,
      region: pane,
      hit: (x, y) => currentCarry() !== null && pointerIn(x, y),
      measureHit: () => {
        const el = pane();
        if (el === null) return () => false;
        const b = el.getBoundingClientRect();
        const grip = gripBox();
        // Open now's own drag stays its own (KAN-352), and so does an adopted
        // saved tab or group, over the header too (adoptedHeaderLanding).
        const held = document.querySelector('[data-drag-held]');
        if (held !== null && el.contains(held)) return () => false;
        return (x, y) => !answersNothing(el) && inPaneBox(b, grip, x, y);
      },
      hover: (x, y) => {
        const carry = currentCarry();
        if (carry?.item.source === 'live') {
          markLiveOver(true);
          return;
        }
        const kind = savedKind(carry);
        if (kind === null || !latest.current.takes) {
          zone = 'none';
          unlightAll();
          setCarryOpens(false);
          return;
        }
        if (kind === 'window') {
          zone = 'window';
          light(pane(), OPEN_NOW_LAST_TARGET, true);
          setCarryOpens(true);
          return;
        }
        // Over the list the layer lands nothing: a list adopts the carry there.
        zone = inHeader(x, y) ? 'header' : 'none';
        light(pane(), OPEN_NOW_FIRST_TARGET, zone === 'header');
        setCarryOpens(zone === 'header');
      },
      leave: () => {
        zone = 'none';
        markLiveOver(false);
        unlightAll();
        // An Open now list that adopted the carry owns the + from here
        // (onLandingWindowChange); this leave comes after its first landing.
        const carry = currentCarry();
        if (carry === null || !pointerIn(carry.x, carry.y)) {
          setCarryOpens(false);
        }
      },
      take: () => {
        const carry = currentCarry();
        if (
          carry?.item.source !== 'saved' ||
          !latest.current.takes ||
          zone === 'none'
        ) {
          return false;
        }
        const { dispatch: send, goToURLText: text } = latest.current;
        if (!send(openCarriedCopy(carry.item, { kind: 'newWindow' }, text))) {
          return false;
        }
        // A copy: the source's view comes back. The layer's end is a no-op.
        endCarry('copied');
        return true;
      },
    });

    // 1A, D3. A saved carry once over Currently open only copies: its source
    // keeps its row, and nothing else takes it. Told on every move, so the
    // pane's box, less the grip as the receiver's (KAN-352), is read once per
    // carry.
    let measuredFor: Carry['item'] | null = null;
    let paneBox: DOMRect | null = null;
    let grip: DOMRect | null = null;
    const unsubscribe = subscribeCarry(() => {
      const carry = currentCarry();
      const el = pane();
      if (carry?.item.source !== 'saved' || el === null) {
        measuredFor = null;
        markCrossedOut(false);
        return;
      }
      // KAN-820. Read at the first notify the drawer answers, never mid-slide.
      if (carry.item !== measuredFor && !answersNothing(el)) {
        measuredFor = carry.item;
        paneBox = el.getBoundingClientRect();
        grip = gripBox();
      }
      const over =
        measuredFor === carry.item &&
        paneBox !== null &&
        !answersNothing(el) &&
        inPaneBox(paneBox, grip, carry.x, carry.y);
      noteCarryOverOpenNow(over);
      markCrossedOut(!over && carryCrossedIntoOpenNow() && !slidingIn(el));
    });

    return () => {
      unregister();
      unsubscribe();
      markLiveOver(false);
      markCrossedOut(false);
    };
  }, [paneRef, scrollerRef]);
}
