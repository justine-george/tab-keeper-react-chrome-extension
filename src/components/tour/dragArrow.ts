import type {
  RunDragWay,
  RunDragsTried,
} from '../../redux/slices/globalStateSlice';

// KAN-1030. The drag step's arrow: one at a time, for the way still to try
// (pick B), drawn from where a drag starts to where it lands.

export interface Point {
  x: number;
  y: number;
}

export interface ArrowShape {
  // SVG path data: the curve, then the open chevron at its end.
  line: string;
  head: string;
}

// Left to right before right to left, as the card lists them.
export function arrowWay(tried: RunDragsTried): RunDragWay | null {
  if (!tried.opened) return 'opened';
  if (!tried.saved) return 'saved';
  return null;
}

// Picks M2 and H1. Web Animations, as the theme switch kills CSS transitions.
export const ARROW_MOTION = {
  // From the tab to where it lands, once the card has landed.
  DRAW_MS: 500,
  FIRST_DELAY_MS: 300,
  HEAD_MS: 120,
  // Out on pick-up; drawn on again this long after the drop, by when a tick has landed.
  HIDE_MS: 120,
  AFTER_DROP_MS: 300,
} as const;

const HEAD_ARM = 11;
const HEAD_SPREAD = 0.5;
const round = (n: number): number => Math.round(n * 10) / 10;
const at = (p: Point): string => `${round(p.x)} ${round(p.y)}`;

// Left to right arches over, right to left dips under on the way back, so
// the two never share a path. Shapes measured in the mock (round 1).
function controls(way: RunDragWay, from: Point, to: Point): [Point, Point] {
  const run = Math.abs(to.x - from.x);
  if (way === 'opened') {
    return [
      { x: from.x + run * 0.5, y: from.y - 8 },
      { x: to.x - run * 0.36, y: to.y - 4 },
    ];
  }
  const low = Math.max(from.y, to.y);
  return [
    { x: from.x - run * 0.3, y: low + 56 },
    { x: to.x + run * 0.2, y: low + 46 },
  ];
}

export function arrowShape(
  way: RunDragWay,
  from: Point,
  to: Point
): ArrowShape {
  const [c1, c2] = controls(way, from, to);
  // The curve's direction at its end; from the start when the last control sits on it.
  const back = c2.x === to.x && c2.y === to.y ? from : c2;
  const angle = Math.atan2(to.y - back.y, to.x - back.x);
  const arm = (turn: number): Point => ({
    x: to.x - HEAD_ARM * Math.cos(angle + turn),
    y: to.y - HEAD_ARM * Math.sin(angle + turn),
  });
  return {
    line: `M${at(from)} C${at(c1)} ${at(c2)} ${at(to)}`,
    head: `M${at(arm(HEAD_SPREAD))} L${at(to)} L${at(arm(-HEAD_SPREAD))}`,
  };
}
