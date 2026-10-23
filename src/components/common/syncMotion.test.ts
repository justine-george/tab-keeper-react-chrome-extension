import { describe, expect, it } from 'vitest';
import { DURATION } from '../../styles/scale';
import { MORPH_HALF_TURN, MORPH_UPRIGHT } from './syncMorph.data';
import {
  CROSSFADE_MS,
  easeInOutCubic,
  morphPath,
  morphSetFor,
  settlePose,
} from './syncMotion';

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const flat = (pairs: { from: number[]; to: number[] }[], side: 'from' | 'to') =>
  pairs.flatMap((p) => p[side]);

describe('CROSSFADE_MS', () => {
  it('is the app move duration', () => {
    expect(`${CROSSFADE_MS}ms`).toBe(DURATION.MOVE);
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
  it('uses the upright set for whole turns', () => {
    expect(morphSetFor(0)).toBe(MORPH_UPRIGHT);
    expect(morphSetFor(-360)).toBe(MORPH_UPRIGHT);
    expect(morphSetFor(-720)).toBe(MORPH_UPRIGHT);
  });
  it('uses the half-turn set for odd multiples of 180', () => {
    expect(morphSetFor(-180)).toBe(MORPH_HALF_TURN);
    expect(morphSetFor(180)).toBe(MORPH_HALF_TURN);
    expect(morphSetFor(-540)).toBe(MORPH_HALF_TURN);
  });
  it('throws for an angle that is not a multiple of 180', () => {
    expect(() => morphSetFor(-90)).toThrow(RangeError);
    expect(() => morphSetFor(NaN)).toThrow(RangeError);
  });
});

describe('morphPath', () => {
  for (const [name, pairs] of [
    ['upright', MORPH_UPRIGHT],
    ['half-turn', MORPH_HALF_TURN],
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
