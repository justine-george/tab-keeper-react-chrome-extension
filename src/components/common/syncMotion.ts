import type { IconName } from './iconNames';
import {
  CLOUD_DONE_HALF_TURN,
  CLOUD_DONE_PATH,
  CLOUD_DONE_UPRIGHT,
  type MorphPair,
  SYNC_PROBLEM_HALF_TURN,
  SYNC_PROBLEM_PATH,
  SYNC_PROBLEM_UPRIGHT,
} from './syncMorph.data';

// Timings and curves for the sync glyph's turn-and-morph (KAN-750).
export const TURN_MS = 1000; // one counter-clockwise turn, linear
export const MORPH_MS = 420;
export const CROSSFADE_MS = 200; // = DURATION.MOVE (asserted in the unit test)
export const UNPRESSED_DELAY_MS = 150; // wait before an unpressed sync shows
export const HOLD_MS = 400;
export const BOOT_SYNC_LIMIT_MS = 8000;
export const UNSEEN_MS = 50; // a glyph shown for less than this never draws
export const SETTLE_EASE = 'cubic-bezier(0.5, 0.75, 0.6, 1)';
export const INTO_TURN_EASE = 'cubic-bezier(0.45, 0, 0.75, 0.65)';

const MIN_SETTLE_AHEAD_DEG = 45;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

// The next multiple of 180 at least 45 degrees ahead of a counter-clockwise angle (angles fall).
export function settlePose(angleDeg: number): number {
  const pose = Math.floor(angleDeg / 180) * 180;
  return angleDeg - pose < MIN_SETTLE_AHEAD_DEG ? pose - 180 : pose;
}

interface MorphTargetOutlines {
  // The glyph's own outline, drawn at rest.
  path: string;
  // From the arrows to the glyph, for arrows that settle upright or upside down.
  upright: MorphPair[];
  halfTurn: MorphPair[];
  // From the glyph back to the arrows: the upright set played backwards.
  intoArrows: MorphPair[];
}

const outlines = (
  path: string,
  upright: MorphPair[],
  halfTurn: MorphPair[]
): MorphTargetOutlines => ({
  path,
  upright,
  halfTurn,
  intoArrows: upright.map(({ from, to }) => ({ from: to, to: from })),
});

// The glyphs the sync arrows morph into and back out of; any other change crossfades.
export const MORPH_TARGETS = {
  cloud_done: outlines(
    CLOUD_DONE_PATH,
    CLOUD_DONE_UPRIGHT,
    CLOUD_DONE_HALF_TURN
  ),
  sync_problem: outlines(
    SYNC_PROBLEM_PATH,
    SYNC_PROBLEM_UPRIGHT,
    SYNC_PROBLEM_HALF_TURN
  ),
} satisfies Partial<Record<IconName, MorphTargetOutlines>>;
export type MorphTarget = keyof typeof MORPH_TARGETS;

export const isMorphTarget = (glyph: IconName): glyph is MorphTarget =>
  Object.prototype.hasOwnProperty.call(MORPH_TARGETS, glyph);

// Whole turns end upright; odd half turns end with the glyph turned 180 degrees.
export function morphSetFor(target: MorphTarget, endDeg: number): MorphPair[] {
  if (endDeg % 360 === 0) return MORPH_TARGETS[target].upright;
  if (endDeg % 180 === 0) return MORPH_TARGETS[target].halfTurn;
  throw new RangeError(
    `No morph set for ${endDeg} degrees; it must be a multiple of 180`
  );
}

const fmt = (n: number) => n.toFixed(1);

// A pair's x,y points at t, unrounded: the frame morphPath draws.
export function blendPoints({ from, to }: MorphPair, t: number): number[] {
  if (from.length !== to.length)
    throw new RangeError('A morph pair needs equal-length point lists');
  return from.map((v, i) => v + (to[i] - v) * t);
}

// One closed subpath per pair; t is already eased, 0 draws `from` and 1 draws `to`.
export function morphPath(pairs: MorphPair[], t: number): string {
  return pairs
    .map((pair) => {
      const points = blendPoints(pair, t);
      const xy: string[] = [];
      for (let i = 0; i < points.length; i += 2)
        xy.push(`${fmt(points[i])} ${fmt(points[i + 1])}`);
      return `M${xy.join('L')}Z`;
    })
    .join('');
}

// A closed ring of x,y points as `count` points evenly spaced along its outline.
function resampleRing(ring: number[], count: number): number[] {
  const n = ring.length / 2;
  const at = (i: number) => [ring[(i % n) * 2], ring[(i % n) * 2 + 1]];
  const runs = [0];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(i);
    const [x1, y1] = at(i + 1);
    runs.push(runs[i] + Math.hypot(x1 - x0, y1 - y0));
  }
  const out: number[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const along = (runs[n] * k) / count;
    while (runs[seg + 1] < along) seg++;
    const span = runs[seg + 1] - runs[seg];
    const f = span === 0 ? 0 : (along - runs[seg]) / span;
    const [x0, y0] = at(seg);
    const [x1, y1] = at(seg + 1);
    out.push(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
  }
  return out;
}

// `to` as a ring of from's point count, started where it lies closest to `from`,
// so a morph from one to the other does not twist. Resampled only if the counts differ.
export function matchRing(from: number[], to: number[]): number[] {
  const ring =
    to.length === from.length ? to : resampleRing(to, from.length / 2);
  const n = ring.length / 2;
  let best = 0;
  let bestCost = Infinity;
  for (let k = 0; k < n; k++) {
    let cost = 0;
    for (let j = 0; j < n && cost < bestCost; j++) {
      const i = ((j + k) % n) * 2;
      cost +=
        (ring[i] - from[j * 2]) ** 2 + (ring[i + 1] - from[j * 2 + 1]) ** 2;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  }
  return [...ring.slice(best * 2), ...ring.slice(0, best * 2)];
}

// A morph from the rings on screen to `ends`: ring i runs to ends[i]'s end. An end
// with no ring on screen grows as its own set would; a ring with no end shrinks to
// a point where it is (the sets differ in ring count).
export function pairsFromFrame(
  rings: number[][],
  ends: MorphPair[]
): MorphPair[] {
  const toEnds = ends.map((end, i) =>
    i < rings.length ? { from: rings[i], to: matchRing(rings[i], end.to) } : end
  );
  const shrinking = rings.slice(ends.length).map((ring) => {
    const n = ring.length / 2;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length; i += 2) {
      x += ring[i] / n;
      y += ring[i + 1] / n;
    }
    return { from: ring, to: ring.map((_, i) => (i % 2 === 0 ? x : y)) };
  });
  return [...toEnds, ...shrinking];
}
