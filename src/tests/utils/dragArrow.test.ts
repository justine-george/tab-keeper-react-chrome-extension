import { describe, expect, test } from 'vitest';

import {
  arrowShape,
  arrowWay,
  type Point,
} from '../../components/tour/dragArrow';

// The numbers in a path, in order.
const numbers = (d: string): number[] =>
  (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('arrowWay (KAN-1030 pick B: the way still to try)', () => {
  test('left to right first, then right to left, then none', () => {
    expect(arrowWay({ opened: false, saved: false })).toBe('opened');
    expect(arrowWay({ opened: true, saved: false })).toBe('saved');
    expect(arrowWay({ opened: true, saved: true })).toBeNull();
  });

  test('right to left tried first: left to right is the one left', () => {
    expect(arrowWay({ opened: false, saved: true })).toBe('opened');
  });
});

describe('arrowShape', () => {
  // The mock's measured ends (1280 × 800 full view, sample session).
  const tab: Point = { x: 700, y: 176 };
  const gap: Point = { x: 902, y: 304 };

  test('left to right: starts at the tab, ends at the gap, arching over', () => {
    const { line } = arrowShape('opened', tab, gap);
    const n = numbers(line);
    expect(n.slice(0, 2)).toEqual([700, 176]);
    expect(n.slice(-2)).toEqual([902, 304]);
    // The first control point lifts above the start: an arch, not a sag.
    expect(n[3]).toBeLessThan(176);
  });

  test('right to left: dips under both ends on the way back', () => {
    const live: Point = { x: 902, y: 384 };
    const session: Point = { x: 700, y: 352 };
    const n = numbers(arrowShape('saved', live, session).line);
    expect(n.slice(0, 2)).toEqual([902, 384]);
    expect(n.slice(-2)).toEqual([700, 352]);
    expect(n[3]).toBeGreaterThan(384);
    expect(n[5]).toBeGreaterThan(384);
  });

  test('the head is a chevron whose tip is the end, its arms behind it along the curve', () => {
    const { head } = arrowShape('opened', tab, gap);
    const n = numbers(head);
    expect(n.slice(2, 4)).toEqual([902, 304]);
    // Both arms trail to the left of a rightward end, one above and one below.
    expect(n[0]).toBeLessThan(902);
    expect(n[4]).toBeLessThan(902);
    expect(Math.sign(n[1] - 304)).not.toBe(Math.sign(n[5] - 304));
    expect(Math.hypot(n[0] - 902, n[1] - 304)).toBeCloseTo(11, 0);
  });

  test('right to left: the head points up and left, into the session from under it', () => {
    const n = numbers(
      arrowShape('saved', { x: 902, y: 384 }, { x: 700, y: 352 }).head
    );
    expect(n.slice(2, 4)).toEqual([700, 352]);
    expect(n[1]).toBeGreaterThan(352);
    expect(n[5]).toBeGreaterThan(352);
    expect((n[0] + n[4]) / 2).toBeGreaterThan(700);
  });
});
