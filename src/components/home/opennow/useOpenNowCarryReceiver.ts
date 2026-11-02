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
// - A saved window is never adopted. Over an open window of its kind, that
//   whole window lights and a release adds its tabs there (KAN-892 D);
//   anywhere else in the pane the block below the last window lights, and a
//   release opens it as a new window (r1 3 A).
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
import { openCarriedCopy, type CopyPlace } from '../../../redux/openCopy';
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
  // KAN-892. Whether the saved window carried opens incognito (OpenNowPane: its mark, and Tab Keeper allowed there).
  carriedIncognito: () => boolean;
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

// KAN-892 D. An open window's block, in the list's content space (its top as
// measured plus the scroll then), down to the next block's top: the gap
// between two is the upper one's, so nothing lights between them.
interface WindowBlock {
  windowId: number;
  incognito: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface MeasuredBlocks {
  blocks: WindowBlock[];
  // The scroller's box: a block scrolled under the header is not under the pointer.
  list: DOMRect;
}

function measureBlocks(
  pane: HTMLElement,
  scroller: HTMLElement
): MeasuredBlocks {
  const scrollTop = scroller.scrollTop;
  const boxes = [
    ...pane.querySelectorAll<HTMLElement>('[data-open-window-id]'),
  ].map((el) => ({ el, box: el.getBoundingClientRect() }));
  return {
    list: scroller.getBoundingClientRect(),
    blocks: boxes.map(({ el, box }, i) => ({
      windowId: Number(el.getAttribute('data-open-window-id')),
      incognito: el.hasAttribute('data-window-incognito'),
      left: box.left,
      right: box.right,
      top: box.top + scrollTop,
      bottom: (boxes[i + 1]?.box.top ?? box.bottom) + scrollTop,
    })),
  };
}

// The block under the pointer, as the list is scrolled now.
function blockAt(
  m: MeasuredBlocks,
  scrollTop: number,
  x: number,
  y: number
): WindowBlock | null {
  if (!inBox(m.list, x, y)) return null;
  const at = y + scrollTop;
  return (
    m.blocks.find(
      (b) => x >= b.left && x < b.right && at >= b.top && at < b.bottom
    ) ?? null
  );
}

// Written straight to the DOM, as the boxes are; null unlights every window.
function lightWindow(pane: HTMLElement | null, windowId: number | null): void {
  for (const el of pane?.querySelectorAll('[data-open-window-id]') ?? []) {
    el.toggleAttribute(
      'data-landing',
      el.getAttribute('data-open-window-id') === String(windowId)
    );
  }
}

const savedKind = (carry: Carry | null) =>
  carry?.item.source === 'saved' ? pickOf(carry.item).kind : null;

export function useOpenNowCarryReceiver({
  paneRef,
  scrollerRef,
  takes,
  goToURLText,
  carriedIncognito,
}: Options): void {
  const dispatch: AppDispatch = useDispatch();
  // Read when the receiver is asked, not when it registered.
  const latest = useRef({ takes, goToURLText, dispatch, carriedIncognito });
  useEffect(() => {
    latest.current = { takes, goToURLText, dispatch, carriedIncognito };
  }, [takes, goToURLText, dispatch, carriedIncognito]);

  useEffect(() => {
    const pane = () => paneRef.current;
    const headerBottom = (paneBox: DOMRect) =>
      scrollerRef.current?.getBoundingClientRect().top ?? paneBox.top;
    // KAN-871. A live carry comes back to the pane's own edge, the grip's inside half too (KAN-611).
    const gripFor = (carry: Carry | null) =>
      carry?.item.source === 'live' ? null : gripBox();
    const pointerIn = (x: number, y: number): boolean => {
      const el = pane();
      return (
        el !== null &&
        !answersNothing(el) &&
        inPaneBox(el.getBoundingClientRect(), gripFor(currentCarry()), x, y)
      );
    };
    const inHeader = (x: number, y: number): boolean => {
      const el = pane();
      if (el === null || answersNothing(el)) return false;
      const b = el.getBoundingClientRect();
      return inBox(b, x, y) && y < headerBottom(b);
    };
    // Where the layer last hovered: what take() opens; null, nothing.
    let place: CopyPlace | null = null;
    // KAN-892 D. A window carry's blocks, read once while it is over the pane.
    let measured: MeasuredBlocks | null = null;
    const scrollTopNow = () => scrollerRef.current?.scrollTop ?? 0;
    // R15, R16 (KAN-855). A window carry's box below the last window, pinned
    // over the list's bottom the whole carry: there it wins over the window
    // drawn beneath. Pinned, it keeps its place however the list scrolls, but
    // at the list's end it rides up by its margin: read once, and again only
    // after a scroll.
    let boxBelow: { rect: DOMRect; scrollTop: number } | null = null;
    const boxBelowNow = (): DOMRect | null => {
      const scrollTop = scrollTopNow();
      if (boxBelow === null || boxBelow.scrollTop !== scrollTop) {
        const rect = pane()
          ?.querySelector(`[data-new-window-target="${OPEN_NOW_LAST_TARGET}"]`)
          ?.getBoundingClientRect();
        boxBelow = rect === undefined ? null : { rect, scrollTop };
      }
      return boxBelow?.rect ?? null;
    };
    // The window lit now: the DOM is written only when it changes.
    let litWindow: number | null = null;
    const showWindow = (windowId: number | null) => {
      if (windowId === litWindow) return;
      litWindow = windowId;
      lightWindow(pane(), windowId);
    };

    const unlightAll = () => {
      light(pane(), OPEN_NOW_FIRST_TARGET, false);
      light(pane(), OPEN_NOW_LAST_TARGET, false);
      showWindow(null);
    };

    // The open window of its kind under the pointer, else none.
    const windowTarget = (x: number, y: number): number | null => {
      const el = pane();
      const scroller = scrollerRef.current;
      if (el === null || scroller === null) return null;
      measured ??= measureBlocks(el, scroller);
      const over = blockAt(measured, scrollTopNow(), x, y);
      return over !== null &&
        over.incognito === latest.current.carriedIncognito()
        ? over.windowId
        : null;
    };

    const unregister = registerCarryReceiver({
      inCurrentlyOpen: true,
      region: pane,
      hit: (x, y) => currentCarry() !== null && pointerIn(x, y),
      measureHit: () => {
        const el = pane();
        if (el === null) return () => false;
        const b = el.getBoundingClientRect();
        // A list's own drag has no carry yet: a saved one keeps KAN-352.
        const grip = gripFor(currentCarry());
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
          place = null;
          unlightAll();
          setCarryOpens(false);
          return;
        }
        if (kind === 'window') {
          const box = boxBelowNow();
          const windowId =
            box !== null && inBox(box, x, y) ? null : windowTarget(x, y);
          place =
            windowId === null
              ? { kind: 'newWindow' }
              : { kind: 'intoWindow', windowId };
          showWindow(windowId);
          light(pane(), OPEN_NOW_LAST_TARGET, windowId === null);
          setCarryOpens(true);
          return;
        }
        // Over the list the layer lands nothing: a list adopts the carry there.
        const header = inHeader(x, y);
        place = header ? { kind: 'newWindow' } : null;
        light(pane(), OPEN_NOW_FIRST_TARGET, header);
        setCarryOpens(header);
      },
      leave: () => {
        place = null;
        // Read afresh on the way back in: a drawer may have moved since.
        measured = null;
        boxBelow = null;
        markLiveOver(false);
        // An Open now list that adopted the carry owns the + and the boxes
        // from here (onLandingWindowChange); this leave comes after its first
        // landing, which may be the block below the last window (KAN-856).
        const carry = currentCarry();
        if (carry === null || !pointerIn(carry.x, carry.y)) {
          unlightAll();
          setCarryOpens(false);
        }
      },
      take: () => {
        const carry = currentCarry();
        if (
          carry?.item.source !== 'saved' ||
          !latest.current.takes ||
          place === null
        ) {
          return false;
        }
        const { dispatch: send, goToURLText: text } = latest.current;
        if (send(openCarriedCopy(carry.item, place, text)) === null) {
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
        measured = null;
        boxBelow = null;
        showWindow(null);
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
