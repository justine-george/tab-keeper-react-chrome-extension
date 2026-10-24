import { describe, expect, test } from 'vitest';

import {
  CLOUD_DONE_PATH,
  CLOUD_DONE_HALF_TURN,
  CLOUD_DONE_UPRIGHT,
  SYNC_PATH,
  SYNC_PROBLEM_HALF_TURN,
  SYNC_PROBLEM_PATH,
  SYNC_PROBLEM_UPRIGHT,
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

// How far a point lies from a closed ring's outline.
function offRing([px, py], ring) {
  return Math.min(
    ...ring.map(([ax, ay], i) => {
      const [bx, by] = ring[(i + 1) % ring.length];
      const [dx, dy] = [bx - ax, by - ay];
      const len = dx * dx + dy * dy;
      const t =
        len === 0
          ? 0
          : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
      return Math.hypot(ax + t * dx - px, ay + t * dy - py);
    })
  );
}

const near = (a, b, tolerance) =>
  Object.keys(a).every((k) => Math.abs(a[k] - b[k]) <= tolerance);

// The SVG data the app animates is baked by scripts/build_sync_morph.mjs. A
// hand edit, or a changed script with no rerun, would drift from the glyphs.
describe('buildMorphData', () => {
  test('committed data is what the script builds', () => {
    expect(buildMorphData()).toEqual({
      SYNC_PATH,
      CLOUD_DONE_PATH,
      SYNC_PROBLEM_PATH,
      CLOUD_DONE_UPRIGHT,
      CLOUD_DONE_HALF_TURN,
      SYNC_PROBLEM_UPRIGHT,
      SYNC_PROBLEM_HALF_TURN,
    });
  });

  test('each pair has equal lengths and an even count', () => {
    for (const [set, count] of [
      [CLOUD_DONE_UPRIGHT, 3],
      [CLOUD_DONE_HALF_TURN, 3],
      [SYNC_PROBLEM_UPRIGHT, 4],
      [SYNC_PROBLEM_HALF_TURN, 4],
    ]) {
      expect(set).toHaveLength(count);
      for (const { from, to } of set) {
        expect(from.length).toBe(to.length);
        expect(from.length % 2).toBe(0);
        expect(from.length).toBeGreaterThan(0);
      }
    }
  });

  test('upright ends draw the two glyphs', () => {
    const outline = (d) => boxOf(outlineRings(d).flat());
    const from = boxOf(pointsOf(CLOUD_DONE_UPRIGHT, 'from'));
    const to = boxOf(pointsOf(CLOUD_DONE_UPRIGHT, 'to'));
    expect(near(from, outline(SYNC_PATH), 2)).toBe(true);
    expect(near(to, outline(CLOUD_DONE_PATH), 2)).toBe(true);
    expect(Math.abs(to.minX - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(to.maxX - 920)).toBeLessThanOrEqual(2);
    expect(Math.abs(to.minY - -799)).toBeLessThanOrEqual(2);
    expect(Math.abs(to.maxY - -160)).toBeLessThanOrEqual(2);
  });

  // The half-turn set ends turned 180°: the svg's own half turn draws it upright.
  test.each([
    // Pair 0 and 1 swap sides; pair 2 (the check) stays itself.
    ['cloud', CLOUD_DONE_HALF_TURN, CLOUD_DONE_UPRIGHT, [1, 0, 2]],
    // The arrows swap sides; the "!" bar and dot stay themselves.
    [
      'sync_problem',
      SYNC_PROBLEM_HALF_TURN,
      SYNC_PROBLEM_UPRIGHT,
      [1, 0, 2, 3],
    ],
  ])(
    'the %s half-turn set is the upright one turned 180°',
    (_, halfTurn, upright, swapped) => {
      swapped.forEach((from, i) => {
        const turned = pointsOf([halfTurn[i]], 'to').map(([x, y]) => [
          960 - x,
          -960 - y,
        ]);
        const target = pointsOf([upright[from]], 'to');
        // Both ways: each ring's points lie on the other's outline.
        for (const [a, b] of [
          [turned, target],
          [target, turned],
        ]) {
          for (const p of a) expect(offRing(p, b)).toBeLessThanOrEqual(0.2);
        }
      });
    }
  );

  test('sync_problem ends draw sync and sync_problem', () => {
    const outline = (d) => boxOf(outlineRings(d).flat());
    const from = boxOf(pointsOf(SYNC_PROBLEM_UPRIGHT, 'from'));
    const to = boxOf(pointsOf(SYNC_PROBLEM_UPRIGHT, 'to'));
    expect(near(from, outline(SYNC_PATH), 2)).toBe(true);
    expect(near(to, outline(SYNC_PROBLEM_PATH), 2)).toBe(true);
    expect(near(to, { minX: 128, maxX: 832, minY: -800, maxY: -160 }, 2)).toBe(
      true
    );
  });

  // Pairs 2 and 3: the "!" bar and dot, each growing from a point at its own centre.
  test.each([
    ['upright', SYNC_PROBLEM_UPRIGHT],
    ['half-turn', SYNC_PROBLEM_HALF_TURN],
  ])('the %s set grows the "!" from points', (_, set) => {
    const centreOf = (box) => [
      (box.minX + box.maxX) / 2,
      (box.minY + box.maxY) / 2,
    ];
    const sizes = [];
    for (const pair of set.slice(2)) {
      const seed = boxOf(pointsOf([pair], 'from'));
      const part = boxOf(pointsOf([pair], 'to'));
      expect(seed.maxX - seed.minX).toBeLessThanOrEqual(4);
      expect(seed.maxY - seed.minY).toBeLessThanOrEqual(4);
      const [sx, sy] = centreOf(seed);
      const [px, py] = centreOf(part);
      expect(Math.hypot(sx - px, sy - py)).toBeLessThanOrEqual(3);
      sizes.push((part.maxX - part.minX) * (part.maxY - part.minY));
    }
    // The bar, then the dot.
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
  });
});
