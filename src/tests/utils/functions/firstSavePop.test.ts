import { describe, expect, test } from 'vitest';

import {
  popPieces,
  type PopPiece,
} from '../../../utils/functions/firstSavePop';

// KAN-875. Where each piece of the first save's pop flies to (V4, round 2).

const BIT_COLOURS = ['#99bf9d', '#7fa884', '#d09263', '#e3b98f'];

// A fixed, spread-out sequence, so every range is exercised the same way each run.
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const RANDOMS = {
  seeded: seeded(875),
  lowest: () => 0,
  highest: () => 0.999,
};

const degrees = (p: PopPiece) => (Math.atan2(p.dy, p.dx) * 180) / Math.PI;
const distance = (p: PopPiece) => Math.hypot(p.dx, p.dy);
// The signed gap between two angles, in (-180, 180].
const gap = (a: number, b: number) => {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

for (const [name, random] of Object.entries(RANDOMS)) {
  describe(`the pop's pieces (${name} random)`, () => {
    const pieces = popPieces(random);
    const disks = pieces.filter((p) => p.kind === 'disk');
    const bits = pieces.filter((p) => p.kind === 'bit');

    test('12 disks and 12 bits', () => {
      expect(pieces).toHaveLength(24);
      expect(disks).toHaveLength(12);
      expect(bits).toHaveLength(12);
    });

    test('disks are 14px, in the mark’s body colour', () => {
      for (const d of disks) {
        expect(d).toMatchObject({ width: 14, height: 14, colour: '#445562' });
      }
    });

    test('bits are 5–8 by 8–12px, in the mark’s colours', () => {
      for (const b of bits) {
        expect(b.width).toBeGreaterThanOrEqual(5);
        expect(b.width).toBeLessThanOrEqual(8);
        expect(b.height).toBeGreaterThanOrEqual(8);
        expect(b.height).toBeLessThanOrEqual(12);
        expect(BIT_COLOURS).toContain(b.colour);
      }
      expect(new Set(bits.map((b) => b.colour))).toEqual(new Set(BIT_COLOURS));
    });

    test('disk i leaves at i × 30°, within 10°, and stops 70–90px out', () => {
      disks.forEach((d, i) => {
        expect(Math.abs(gap(degrees(d), i * 30))).toBeLessThanOrEqual(10.0001);
        expect(distance(d)).toBeGreaterThanOrEqual(70 - 1e-9);
        expect(distance(d)).toBeLessThanOrEqual(90 + 1e-9);
      });
    });

    test('bit i leaves between disks, at i × 30° + 15°, and stops 55–75px out', () => {
      bits.forEach((b, i) => {
        expect(Math.abs(gap(degrees(b), i * 30 + 15))).toBeLessThan(1e-6);
        expect(distance(b)).toBeGreaterThanOrEqual(55 - 1e-9);
        expect(distance(b)).toBeLessThanOrEqual(75 + 1e-9);
      });
    });

    test('disks tumble up to half a turn, bits up to a whole one', () => {
      for (const d of disks) expect(Math.abs(d.turn)).toBeLessThanOrEqual(0.5);
      for (const b of bits) expect(Math.abs(b.turn)).toBeLessThanOrEqual(1);
    });
  });
}

test('the jitter comes from the random it is handed', () => {
  const low = popPieces(RANDOMS.lowest).filter((p) => p.kind === 'disk');
  const high = popPieces(RANDOMS.highest).filter((p) => p.kind === 'disk');
  expect(gap(degrees(low[1]), 30)).toBeCloseTo(-10, 5);
  expect(gap(degrees(high[1]), 30)).toBeCloseTo(9.98, 1);
  expect(distance(low[1])).toBeCloseTo(70, 5);
  expect(distance(high[1])).toBeCloseTo(89.98, 1);
});
