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
export interface AnchoredPlacement {
  side: CoachSide;
  left: number;
  top: number;
  notch: number;
}

// KAN-755. A card with no anchor: at the top of the page, with no notch.
export interface FreePlacement {
  side: 'free';
  left: number;
  top: number;
}

export type CoachPlacement = AnchoredPlacement | FreePlacement;

// bright: the box left undimmed, the anchor's own unless the step lights more.
// openings (KAN-900): more undimmed boxes, each a hole of its own, outside the ring.
export type CoachFrame =
  | {
      kind: 'anchored';
      anchor: Box;
      bright: Box;
      openings: readonly Box[];
      placement: AnchoredPlacement;
    }
  | { kind: 'free'; placement: FreePlacement };

export interface CoachAction {
  label: string;
  onPress: () => void;
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
  FREE_LEFT: 40,
  FREE_TOP: 20,
} as const;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

const aimX = (anchor: Box): number =>
  anchor.left + Math.min(anchor.width / 2, COACH.BELOW_AIM);
const aimY = (anchor: Box): number => anchor.top + anchor.height / 2;

// The mark clears `bright`; its notch still aims at `anchor`.
function unclamped(side: CoachSide, anchor: Box, mark: Size, bright: Box) {
  if (side === 'below') {
    return {
      left: aimX(anchor) - COACH.NOTCH_INSET,
      top: bright.top + bright.height + COACH.GAP_BELOW,
    };
  }
  const left =
    side === 'right'
      ? bright.left + bright.width + COACH.GAP_SIDE
      : bright.left - COACH.GAP_SIDE - mark.width;
  return { left, top: aimY(bright) - mark.height / 2 };
}

function settle(
  side: CoachSide,
  raw: { left: number; top: number },
  anchor: Box,
  mark: Size,
  viewport: Size
): AnchoredPlacement {
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
  sides: readonly CoachSide[],
  bright: Box = anchor
): AnchoredPlacement {
  const fits = (side: CoachSide): boolean => {
    const raw = unclamped(side, anchor, mark, bright);
    return side === 'below'
      ? raw.top + mark.height <= viewport.height - COACH.GUTTER
      : raw.left >= COACH.GUTTER &&
          raw.left + mark.width <= viewport.width - COACH.GUTTER;
  };
  const side = sides.find(fits) ?? sides[0] ?? 'below';
  return settle(
    side,
    unclamped(side, anchor, mark, bright),
    anchor,
    mark,
    viewport
  );
}

// Popup: always in the left pane, 40px in, the notch pointing right at the anchor.
export function placeInPopupPane(
  anchor: Box,
  mark: Size,
  viewport: Size
): AnchoredPlacement {
  const raw = {
    left: Math.min(COACH.POPUP_LEFT, anchor.left - COACH.GAP_SIDE - mark.width),
    top: aimY(anchor) - mark.height / 2,
  };
  return settle('left', raw, anchor, mark, viewport);
}

// Step 9 has no anchor: the card sits at the top of the page.
export function placeFree(mark: Size, viewport: Size): FreePlacement {
  const left = clamp(
    COACH.FREE_LEFT,
    COACH.GUTTER,
    viewport.width - mark.width - COACH.GUTTER
  );
  return {
    side: 'free',
    left,
    top: COACH.FREE_TOP,
  };
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

// Past any viewport, so the dim's own box (fixed, inset 0) clips the outer
// edge and a resize never needs a new path.
const DIM_EXTENT = 100000;

// Points per squircle corner; at a 12px corner each is within 0.02px of the curve.
const CORNER_STEPS = 16;
const at = (n: number): number => Number(n.toFixed(3));

// One quarter of a CSS squircle (superellipse(2): |x|^4 + |y|^4 = k^4) round
// (cx, cy), from angle `from` a quarter turn on, as line-tos. clip-path's
// path() has no squircle, and an arc of the same radius is rounder (KAN-901).
function squircleCorner(
  cx: number,
  cy: number,
  k: number,
  from: number
): string {
  let out = '';
  for (let i = 1; i <= CORNER_STEPS; i++) {
    const angle = from + (i / CORNER_STEPS) * (Math.PI / 2);
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    out += `L${at(cx + k * Math.sign(c) * Math.sqrt(Math.abs(c)))} ${at(
      cy + k * Math.sign(s) * Math.sqrt(Math.abs(s))
    )}`;
  }
  return out;
}

// KAN-901. A hole's corner radii in px: top-left, top-right, bottom-right,
// bottom-left, as CSS border-radius lists them.
export type HoleCorners = readonly [number, number, number, number];
export const sameCorners = (px: number): HoleCorners => [px, px, px, px];

export interface Hole {
  box: Box;
  corners: HoleCorners;
}

// A clip-path keeping the whole element but each hole, in the element's own
// px, each corner a squircle of its radius (KAN-721, KAN-901), capped at half
// the hole's sides.
export function clipPathWithHoles(holes: readonly Hole[]): string {
  const hole = ({ box, corners }: Hole) => {
    const [tl, tr, br, bl] = corners.map((c) =>
      Math.min(c, box.width / 2, box.height / 2)
    );
    const { left: l, top: t } = box;
    const r = l + box.width;
    const b = t + box.height;
    return (
      ` M${l + tl} ${t}H${r - tr}${squircleCorner(r - tr, t + tr, tr, -Math.PI / 2)}` +
      `V${b - br}${squircleCorner(r - br, b - br, br, 0)}` +
      `H${l + bl}${squircleCorner(l + bl, b - bl, bl, Math.PI / 2)}` +
      `V${t + tl}${squircleCorner(l + tl, t + tl, tl, Math.PI)}Z`
    );
  };
  return (
    `path(evenodd, "M0 0H${DIM_EXTENT}V${DIM_EXTENT}H0Z` +
    holes.map(hole).join('') +
    '")'
  );
}

const sameBox = (a: Box, b: Box): boolean =>
  a.left === b.left &&
  a.top === b.top &&
  a.width === b.width &&
  a.height === b.height;

export function sameFrame(a: CoachFrame | null, b: CoachFrame | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'free' || b.kind === 'free') {
    return (
      a.kind === b.kind &&
      a.placement.left === b.placement.left &&
      a.placement.top === b.placement.top
    );
  }
  return (
    sameBox(a.anchor, b.anchor) &&
    sameBox(a.bright, b.bright) &&
    a.openings.length === b.openings.length &&
    a.openings.every((box, i) => sameBox(box, b.openings[i])) &&
    a.placement.side === b.placement.side &&
    a.placement.left === b.placement.left &&
    a.placement.top === b.placement.top &&
    a.placement.notch === b.placement.notch
  );
}
