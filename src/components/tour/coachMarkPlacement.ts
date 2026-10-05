// KAN-413. Pure, in CSS px: where a mark goes beside an anchor, inside the window.

export type CoachSide = 'right' | 'left' | 'below';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

// notch: along the facing edge, from the mark's top (left, right) or left (below).
export interface CoachPlacement {
  side: CoachSide;
  left: number;
  top: number;
  notch: number;
}

// bright: the box left undimmed, the anchor's own unless the step lights more.
export interface CoachFrame {
  anchor: Box;
  bright: Box;
  placement: CoachPlacement;
}

// Gaps measured off the picked mocks; the ring sits RING_INSET outside its anchor.
export const COACH = {
  GUTTER: 8,
  GAP_SIDE: 28,
  GAP_BELOW: 14,
  NOTCH_INSET: 24,
  NOTCH_MIN: 14,
  BELOW_AIM: 46,
  POPUP_LEFT: 40,
  RING_INSET: 4,
} as const;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

const aimX = (anchor: Box): number =>
  anchor.left + Math.min(anchor.width / 2, COACH.BELOW_AIM);
const aimY = (anchor: Box): number => anchor.top + anchor.height / 2;

function unclamped(side: CoachSide, anchor: Box, mark: Size) {
  if (side === 'below') {
    return {
      left: aimX(anchor) - COACH.NOTCH_INSET,
      top: anchor.top + anchor.height + COACH.GAP_BELOW,
    };
  }
  const left =
    side === 'right'
      ? anchor.left + anchor.width + COACH.GAP_SIDE
      : anchor.left - COACH.GAP_SIDE - mark.width;
  return { left, top: aimY(anchor) - mark.height / 2 };
}

function settle(
  side: CoachSide,
  raw: { left: number; top: number },
  anchor: Box,
  mark: Size,
  viewport: Size
): CoachPlacement {
  const left = clamp(
    raw.left,
    COACH.GUTTER,
    viewport.width - mark.width - COACH.GUTTER
  );
  const top = clamp(
    raw.top,
    COACH.GUTTER,
    viewport.height - mark.height - COACH.GUTTER
  );
  const notch =
    side === 'below'
      ? clamp(
          aimX(anchor) - left,
          COACH.NOTCH_MIN,
          mark.width - COACH.NOTCH_MIN
        )
      : clamp(
          aimY(anchor) - top,
          COACH.NOTCH_MIN,
          mark.height - COACH.NOTCH_MIN
        );
  return { side, left, top, notch };
}

// Full view: the first side that fits the window, else the first side, clamped.
export function placeBeside(
  anchor: Box,
  mark: Size,
  viewport: Size,
  sides: readonly CoachSide[]
): CoachPlacement {
  const fits = (side: CoachSide): boolean => {
    const raw = unclamped(side, anchor, mark);
    return side === 'below'
      ? raw.top + mark.height <= viewport.height - COACH.GUTTER
      : raw.left >= COACH.GUTTER &&
          raw.left + mark.width <= viewport.width - COACH.GUTTER;
  };
  const side = sides.find(fits) ?? sides[0] ?? 'below';
  return settle(side, unclamped(side, anchor, mark), anchor, mark, viewport);
}

// Popup: always in the left pane, 40px in, the notch pointing right at the anchor.
export function placeInPopupPane(
  anchor: Box,
  mark: Size,
  viewport: Size
): CoachPlacement {
  const raw = {
    left: Math.min(COACH.POPUP_LEFT, anchor.left - COACH.GAP_SIDE - mark.width),
    top: aimY(anchor) - mark.height / 2,
  };
  return settle('left', raw, anchor, mark, viewport);
}

// The smallest box holding every drawn box; null when none is drawn.
export function unionBox(boxes: readonly Box[]): Box | null {
  const drawn = boxes.filter((b) => b.width > 0 && b.height > 0);
  if (drawn.length === 0) return null;
  const left = Math.min(...drawn.map((b) => b.left));
  const top = Math.min(...drawn.map((b) => b.top));
  const right = Math.max(...drawn.map((b) => b.left + b.width));
  const bottom = Math.max(...drawn.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

// The part of `a` inside `b`; null when they share no area.
export function intersectBox(a: Box, b: Box): Box | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}

// The ring's box: RING_INSET outside the box it rings.
export function ringBox(box: Box): Box {
  return {
    left: box.left - COACH.RING_INSET,
    top: box.top - COACH.RING_INSET,
    width: box.width + 2 * COACH.RING_INSET,
    height: box.height + 2 * COACH.RING_INSET,
  };
}

// A clip-path keeping the whole element but `box`, in the element's own px.
export function clipPathWithHole(box: Box): string {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  return (
    'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ' +
    `${box.left}px ${box.top}px, ${right}px ${box.top}px, ` +
    `${right}px ${bottom}px, ${box.left}px ${bottom}px, ${box.left}px ${box.top}px)`
  );
}

const sameBox = (a: Box, b: Box): boolean =>
  a.left === b.left &&
  a.top === b.top &&
  a.width === b.width &&
  a.height === b.height;

export function sameFrame(a: CoachFrame | null, b: CoachFrame | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    sameBox(a.anchor, b.anchor) &&
    sameBox(a.bright, b.bright) &&
    a.placement.side === b.placement.side &&
    a.placement.left === b.placement.left &&
    a.placement.top === b.placement.top &&
    a.placement.notch === b.placement.notch
  );
}
