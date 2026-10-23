import { describe, expect, test } from 'vitest';

import {
  CLOUD_DONE_PATH,
  MORPH_HALF_TURN,
  MORPH_UPRIGHT,
  SYNC_PATH,
} from '../src/components/common/syncMorph.data.ts';

import { buildMorphData, outlineRings } from './build_sync_morph.mjs';

const pointsOf = (pairs, key) =>
  pairs.flatMap((pair) => {
    const flat = pair[key];
    return Array.from({ length: flat.length / 2 }, (_, i) => [
      flat[2 * i],
      flat[2 * i + 1],
    ]);
  });

const boxOf = (points) => ({
  minX: Math.min(...points.map((p) => p[0])),
  maxX: Math.max(...points.map((p) => p[0])),
  minY: Math.min(...points.map((p) => p[1])),
  maxY: Math.max(...points.map((p) => p[1])),
});

const near = (a, b, tolerance) =>
  Object.keys(a).every((k) => Math.abs(a[k] - b[k]) <= tolerance);

// The SVG data the app animates is baked by scripts/build_sync_morph.mjs. A
// hand edit, or a changed script with no rerun, would drift from the glyphs.
describe('buildMorphData', () => {
  test('committed data is what the script builds', () => {
    expect(buildMorphData()).toEqual({
      SYNC_PATH,
      CLOUD_DONE_PATH,
      MORPH_UPRIGHT,
      MORPH_HALF_TURN,
    });
  });

  test('each pair has equal lengths and an even count', () => {
    for (const set of [MORPH_UPRIGHT, MORPH_HALF_TURN]) {
      expect(set).toHaveLength(3);
      for (const { from, to } of set) {
        expect(from.length).toBe(to.length);
        expect(from.length % 2).toBe(0);
        expect(from.length).toBeGreaterThan(0);
      }
    }
  });

  test('upright ends draw the two glyphs', () => {
    const outline = (d) => boxOf(outlineRings(d).flat());
    const from = boxOf(pointsOf(MORPH_UPRIGHT, 'from'));
    const to = boxOf(pointsOf(MORPH_UPRIGHT, 'to'));
    expect(near(from, outline(SYNC_PATH), 2)).toBe(true);
    expect(near(to, outline(CLOUD_DONE_PATH), 2)).toBe(true);
    expect(Math.abs(to.minX - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(to.maxX - 920)).toBeLessThanOrEqual(2);
    expect(Math.abs(to.minY - -799)).toBeLessThanOrEqual(2);
    expect(Math.abs(to.maxY - -160)).toBeLessThanOrEqual(2);
  });

  test('the half-turn set is the upright cloud turned 180°', () => {
    // Pair 0 and 1 swap sides; pair 2 (the check) stays itself.
    const swapped = [1, 0, 2];
    swapped.forEach((from, i) => {
      const turned = pointsOf([MORPH_HALF_TURN[i]], 'to');
      const target = pointsOf([MORPH_UPRIGHT[from]], 'to');
      expect(turned.length).toBe(target.length);
      for (const [x, y] of turned) {
        const [mx, my] = [960 - x, -960 - y];
        const closest = Math.min(
          ...target.map(([tx, ty]) => Math.hypot(tx - mx, ty - my))
        );
        expect(closest).toBeLessThanOrEqual(0.2);
      }
    });
  });
});
