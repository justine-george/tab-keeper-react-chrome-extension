import {
  type MorphPair,
  MORPH_HALF_TURN,
  MORPH_UPRIGHT,
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

// Whole turns end upright; odd half turns end with the cloud turned 180 degrees.
export function morphSetFor(endDeg: number): MorphPair[] {
  if (endDeg % 360 === 0) return MORPH_UPRIGHT;
  if (endDeg % 180 === 0) return MORPH_HALF_TURN;
  throw new RangeError(
    `No morph set for ${endDeg} degrees; it must be a multiple of 180`
  );
}

const fmt = (n: number) => n.toFixed(1);

// One closed subpath per pair; t is already eased, 0 draws `from` and 1 draws `to`.
export function morphPath(pairs: MorphPair[], t: number): string {
  return pairs
    .map(({ from, to }) => {
      if (from.length !== to.length)
        throw new RangeError('A morph pair needs equal-length point lists');
      const points: string[] = [];
      for (let i = 0; i < from.length; i += 2) {
        points.push(
          `${fmt(from[i] + (to[i] - from[i]) * t)} ${fmt(from[i + 1] + (to[i + 1] - from[i + 1]) * t)}`
        );
      }
      return `M${points.join('L')}Z`;
    })
    .join('');
}
