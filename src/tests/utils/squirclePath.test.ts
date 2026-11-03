import { describe, expect, test } from 'vitest';

import { squircleRect } from '../../styles/squirclePath';

// KAN-908. clip-path's path() has no squircle, so the switch knob's clip traces
// one, as the tour's dim does (KAN-901).

describe('squircleRect (KAN-908)', () => {
  const d = squircleRect({ left: 10, top: 0, right: 60, bottom: 28 }, 7);

  test('is one closed shape of line-tos, no arcs', () => {
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/[AaCcQq]/);
  });

  test('runs along each side of the box and turns each corner at the radius', () => {
    // Top from 17 to 53, right side down to 21, bottom back to 17, left up to 7.
    for (const step of [
      'M17 0',
      'H53',
      'L60 7',
      'V21',
      'L53 28',
      'H17',
      'L10 21',
      'V7',
    ]) {
      expect(d).toContain(step);
    }
  });

  test('its corner is a squircle: fuller than an arc of the same radius', () => {
    // The point at 45° of the top-right corner (centre 53, 7): an arc puts it
    // 7·cos45 ≈ 4.95 out; a superellipse(2) puts it 7·√cos45 ≈ 5.89 out.
    expect(d).toContain(
      `L${(53 + 7 * Math.sqrt(Math.SQRT1_2)).toFixed(3).replace(/0+$/, '')}`
    );
  });

  test('the same box with other edges keeps the same commands, so it can animate', () => {
    const other = squircleRect({ left: -4, top: 0, right: 90, bottom: 28 }, 7);
    const shape = (s: string) => s.replace(/-?[\d.]+/g, '#');
    expect(shape(other)).toBe(shape(d));
  });

  test('a radius past half the height is capped at it', () => {
    const tall = squircleRect({ left: 0, top: 0, right: 40, bottom: 10 }, 7);
    expect(tall).toContain('M5 0');
  });
});
