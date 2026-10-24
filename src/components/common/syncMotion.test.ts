import { describe, expect, it } from 'vitest';
import { DURATION } from '../../styles/scale';
import {
  CLOUD_DONE_HALF_TURN,
  CLOUD_DONE_PATH,
  CLOUD_DONE_UPRIGHT,
  SYNC_PROBLEM_HALF_TURN,
  SYNC_PROBLEM_PATH,
  SYNC_PROBLEM_UPRIGHT,
} from './syncMorph.data';
import {
  blendPoints,
  CROSSFADE_MS,
  easeInOutCubic,
  isMorphTarget,
  matchRing,
  MORPH_TARGETS,
  morphPath,
  morphSetFor,
  pairsFromFrame,
  MORPH_MS,
  SETTLE_DISTANCE_DEG,
  SETTLE_EASE,
  settlePose,
  settleSpot,
  TURN_MS,
  turnMsBetween,
} from './syncMotion';

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const flat = (pairs: { from: number[]; to: number[] }[], side: 'from' | 'to') =>
  pairs.flatMap((p) => p[side]);

describe('CROSSFADE_MS', () => {
  it('is the app move duration', () => {
    expect(`${CROSSFADE_MS}ms`).toBe(DURATION.MOVE);
  });
});

describe('the tuned motion (KAN-750)', () => {
  it('turns once per 800 ms; settles, morphs and presses into the turn in 300 ms', () => {
    expect(TURN_MS).toBe(800);
    expect(MORPH_MS).toBe(300);
    expect(SETTLE_EASE).toBe('cubic-bezier(0.5, 0.75, 0.6, 1)');
  });
});

describe('SETTLE_DISTANCE_DEG', () => {
  // The settle curve's point at parameter s, from the eased string itself.
  const [x1, y1, x2, y2] = (SETTLE_EASE.match(/[\d.]+/g) ?? []).map(Number);
  const bezier = (s: number, p1: number, p2: number) =>
    3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s ** 2 * p2 + s ** 3;

  it('is 90 degrees with the tuned values', () => {
    expect(SETTLE_DISTANCE_DEG).toBe(90);
  });

  it('makes the settle leave at the turn speed', () => {
    const s = 1e-6;
    // Degrees per ms as the settle starts: its distance x the curve's slope over its time.
    const slope = bezier(s, y1, y2) / bezier(s, x1, x2);
    const leaving = (SETTLE_DISTANCE_DEG * slope) / MORPH_MS;
    expect(leaving).toBeCloseTo(360 / TURN_MS, 5);
  });
});

describe('settleSpot', () => {
  it.each([
    // [turn angle now, settles from, settles to]
    [0, -90, -180],
    [-90, -90, -180],
    [-90.5, -270, -360],
    [-135, -270, -360],
    [-270, -270, -360],
    [-300, -450, -540],
    [-359, -450, -540],
  ])('a turn at %d settles from %d to %d', (angle, from, to) => {
    expect(settleSpot(angle)).toEqual({ fromDeg: from, toDeg: to });
  });

  it('is always SETTLE_DISTANCE_DEG before a multiple of 180, under half a turn on', () => {
    for (let a = 0; a > -360; a -= 0.25) {
      const { fromDeg, toDeg } = settleSpot(a);
      expect(toDeg % 180 === 0).toBe(true);
      expect(fromDeg - toDeg).toBe(SETTLE_DISTANCE_DEG);
      expect(a - fromDeg).toBeGreaterThanOrEqual(0);
      expect(a - fromDeg).toBeLessThan(180);
    }
  });
});

describe('turnMsBetween', () => {
  it('is the turn time for the angle between', () => {
    expect(turnMsBetween(0, -360)).toBe(TURN_MS);
    expect(turnMsBetween(-135, -270)).toBe(300);
    expect(turnMsBetween(-90, -90)).toBe(0);
  });
});

describe('settlePose', () => {
  it.each([
    [-10, -180],
    [-60, -180],
    [-200, -360],
    [-226, -360],
    [-135, -180],
    [-136, -360],
  ])('settles %d on %d', (angle, pose) => {
    expect(settlePose(angle)).toBe(pose);
  });

  it('is always a multiple of 180, at least 45 degrees ahead (counter-clockwise)', () => {
    for (let a = 0; a >= -359; a--) {
      const pose = settlePose(a);
      expect(pose % 180 === 0).toBe(true);
      expect(a - pose).toBeGreaterThanOrEqual(45);
    }
  });
});

describe('morphSetFor', () => {
  it.each([
    ['cloud_done', CLOUD_DONE_UPRIGHT, CLOUD_DONE_HALF_TURN],
    ['sync_problem', SYNC_PROBLEM_UPRIGHT, SYNC_PROBLEM_HALF_TURN],
  ] as const)(
    '%s: upright for whole turns, half-turn for odd half turns',
    (target, upright, halfTurn) => {
      expect(morphSetFor(target, 0)).toBe(upright);
      expect(morphSetFor(target, -360)).toBe(upright);
      expect(morphSetFor(target, -720)).toBe(upright);
      expect(morphSetFor(target, -180)).toBe(halfTurn);
      expect(morphSetFor(target, 180)).toBe(halfTurn);
      expect(morphSetFor(target, -540)).toBe(halfTurn);
    }
  );
  it('throws for an angle that is not a multiple of 180', () => {
    expect(() => morphSetFor('cloud_done', -90)).toThrow(RangeError);
    expect(() => morphSetFor('sync_problem', NaN)).toThrow(RangeError);
  });
});

describe('MORPH_TARGETS', () => {
  it('draws each target with its own outline, and flows back by its upright set reversed', () => {
    expect(MORPH_TARGETS.cloud_done.path).toBe(CLOUD_DONE_PATH);
    expect(MORPH_TARGETS.sync_problem.path).toBe(SYNC_PROBLEM_PATH);
    for (const [target, upright] of [
      ['cloud_done', CLOUD_DONE_UPRIGHT],
      ['sync_problem', SYNC_PROBLEM_UPRIGHT],
    ] as const) {
      expect(MORPH_TARGETS[target].intoArrows).toEqual(
        upright.map(({ from, to }) => ({ from: to, to: from }))
      );
    }
  });
  it('names only the glyphs the arrows morph into', () => {
    expect(isMorphTarget('cloud_done')).toBe(true);
    expect(isMorphTarget('sync_problem')).toBe(true);
    expect(isMorphTarget('sync')).toBe(false);
    expect(isMorphTarget('cloud_off')).toBe(false);
  });
});

describe('pairsFromFrame', () => {
  const ring = (cx: number, cy: number) => [
    cx - 1,
    cy - 1,
    cx + 1,
    cy - 1,
    cx + 1,
    cy + 1,
    cx - 1,
    cy + 1,
  ];
  const end = (cx: number, cy: number) => ({
    from: ring(cx, cy),
    to: ring(cx + 10, cy),
  });

  it('runs each ring on screen to its end, without a twist', () => {
    const shown = [ring(0, 0), ring(50, 0)];
    const ends = [end(0, 0), end(50, 0)];
    expect(pairsFromFrame(shown, ends)).toEqual(
      shown.map((from, i) => ({ from, to: matchRing(from, ends[i].to) }))
    );
  });

  it('grows an end with no ring on screen as its own set would', () => {
    const ends = [end(0, 0), end(50, 0), end(90, 0)];
    const pairs = pairsFromFrame([ring(0, 0), ring(50, 0)], ends);
    expect(pairs).toHaveLength(3);
    expect(pairs[2]).toBe(ends[2]);
  });

  it('shrinks a ring with no end to a point where it is', () => {
    const shown = [ring(0, 0), ring(50, 0), ring(90, 20)];
    const pairs = pairsFromFrame(shown, [end(0, 0), end(50, 0)]);
    expect(pairs).toHaveLength(3);
    expect(pairs[2]).toEqual({
      from: shown[2],
      to: [90, 20, 90, 20, 90, 20, 90, 20],
    });
  });
});

describe('morphPath', () => {
  for (const [name, pairs] of [
    ['upright', CLOUD_DONE_UPRIGHT],
    ['half-turn', CLOUD_DONE_HALF_TURN],
  ] as const) {
    it(`${name}: t=0 starts at the first from point and closes 3 subpaths`, () => {
      const d = morphPath(pairs, 0);
      expect(
        d.startsWith(
          `M${pairs[0].from[0].toFixed(1)} ${pairs[0].from[1].toFixed(1)}L`
        )
      ).toBe(true);
      expect(d.match(/Z/g)).toHaveLength(3);
      expect(d.match(/M/g)).toHaveLength(3);
    });
    it(`${name}: t=1 lands on the to points`, () => {
      expect(numbers(morphPath(pairs, 1))).toEqual(
        flat(pairs, 'to').map((n) => Number(n.toFixed(1)))
      );
    });
    it(`${name}: t=0.5 is the midpoint of each pair`, () => {
      const got = numbers(morphPath(pairs, 0.5));
      const from = flat(pairs, 'from');
      const to = flat(pairs, 'to');
      expect(got).toHaveLength(from.length);
      got.forEach((n, k) =>
        expect(Math.abs(n - (from[k] + to[k]) / 2)).toBeLessThanOrEqual(0.051)
      );
    });
  }

  it('rejects a pair whose lists differ in length', () => {
    expect(() => morphPath([{ from: [0, 0, 1, 1], to: [0, 0] }], 0.5)).toThrow(
      RangeError
    );
  });
});

describe('easeInOutCubic', () => {
  it('runs 0 to 1, symmetric about the middle', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 10);
    expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375, 10);
  });
});

describe('blendPoints', () => {
  const pair = { from: [0, 0, 10, 0], to: [10, 10, 30, 20] };
  it('runs from `from` to `to`', () => {
    expect(blendPoints(pair, 0)).toEqual(pair.from);
    expect(blendPoints(pair, 1)).toEqual(pair.to);
    expect(blendPoints(pair, 0.5)).toEqual([5, 5, 20, 10]);
  });

  it('is the frame morphPath draws', () => {
    const t = easeInOutCubic(0.3);
    const points = CLOUD_DONE_UPRIGHT.map((p) => blendPoints(p, t));
    const asPairs = points.map((from) => ({ from, to: from }));
    expect(morphPath(asPairs, 0)).toBe(morphPath(CLOUD_DONE_UPRIGHT, t));
  });
});

// A 10-unit square, as a closed ring of 4 corners.
const SQUARE = [0, 0, 10, 0, 10, 10, 0, 10];
const rotated = (ring: number[], by: number) => [
  ...ring.slice(by * 2),
  ...ring.slice(0, by * 2),
];

describe('matchRing', () => {
  it('starts the ring where it lies closest, keeping its points', () => {
    expect(matchRing(SQUARE, rotated(SQUARE, 1))).toEqual(SQUARE);
    expect(matchRing(SQUARE, rotated(SQUARE, 3))).toEqual(SQUARE);
  });

  it('resamples to the count of `from`, every point on the ring', () => {
    const from = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10, 5, 10, 0, 10, 0, 5];
    const matched = matchRing(from, rotated(SQUARE, 2));
    expect(matched).toHaveLength(from.length);
    // Spaced by arc length: 40 around, 8 points, so the edge midpoints and corners.
    expect(matched).toEqual(from);
  });

  it('leaves equal counts unresampled', () => {
    const to = CLOUD_DONE_HALF_TURN[2].to;
    const matched = matchRing(CLOUD_DONE_UPRIGHT[2].to, to);
    const starts = Array.from({ length: to.length / 2 }, (_, k) =>
      rotated(to, k)
    );
    expect(starts).toContainEqual(matched);
  });

  it('matches a blend back to its own end without a shift', () => {
    const live = blendPoints(CLOUD_DONE_UPRIGHT[0], 0.4);
    expect(matchRing(live, CLOUD_DONE_UPRIGHT[0].from)).toEqual(
      CLOUD_DONE_UPRIGHT[0].from
    );
  });
});
