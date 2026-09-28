import { describe, expect, it } from 'vitest';

import {
  clampOpenNowWidth,
  defaultOpenNowWidth,
  openNowWidthLimits,
  shownOpenNowWidth,
} from '../../components/home/opennow/openNowWidth';

// KAN-321 O1/O1a. Every Open now width number, derived from the viewport
// width alone -- pure, so the same call always answers the same way. This is
// the module the grid, the grip's aria values and its arrow keys all read
// (Task 3), so what is drawn and what a screen reader hears cannot disagree.

describe('defaultOpenNowWidth (D1)', () => {
  it.each([
    [1100, 340],
    [1176, 340],
    [1177, 341],
    [1280, 444],
    [1440, 542],
    [1600, 622],
    [1920, 782],
  ])('is %ipx wide -> %ipx', (viewportWidth, expected) => {
    expect(defaultOpenNowWidth(viewportWidth)).toBe(expected);
  });
});

describe('openNowWidthLimits (L1)', () => {
  it('min is always the floor, 300', () => {
    expect(openNowWidthLimits(1100).min).toBe(300);
    expect(openNowWidthLimits(1920).min).toBe(300);
  });

  // At 1100 the even split (372) would leave the saved session under 480px,
  // so the default floor (340) wins and the max cannot be below it.
  it('max at 1100 is the default floor, 340 (264 < 340)', () => {
    expect(openNowWidthLimits(1100).max).toBe(340);
  });

  it('max at 1280 is 444', () => {
    expect(openNowWidthLimits(1280).max).toBe(444);
  });

  it('max at 1600 is 764', () => {
    expect(openNowWidthLimits(1600).max).toBe(764);
  });

  // L1: the max is never below the default, so the default is always a
  // width the drag can reach.
  it('the default is always inside the limits, from 1100 to 3000', () => {
    for (let w = 1100; w <= 3000; w++) {
      const { min, max } = openNowWidthLimits(w);
      const wanted = defaultOpenNowWidth(w);
      expect(wanted).toBeGreaterThanOrEqual(min);
      expect(wanted).toBeLessThanOrEqual(max);
    }
  });
});

describe('shownOpenNowWidth', () => {
  it('null (no stored choice) shows the default', () => {
    expect(shownOpenNowWidth(null, 1600)).toBe(622);
  });

  it('a stored width inside the limits shows unchanged', () => {
    expect(shownOpenNowWidth(500, 1600)).toBe(500);
  });

  it('a stored width below the floor clamps up to it', () => {
    expect(shownOpenNowWidth(200, 1600)).toBe(300);
  });

  it('a stored width above the max clamps down to it', () => {
    expect(shownOpenNowWidth(2000, 1600)).toBe(764);
  });

  // Pure: the same stored width comes back different at different window
  // widths, and the same call always answers the same way -- this is two
  // separate calls, not one call remembering the last window.
  it('the same stored width clamps at 1280, then comes back unclamped at 1600', () => {
    expect(shownOpenNowWidth(700, 1280)).toBe(444);
    expect(shownOpenNowWidth(700, 1600)).toBe(700);
  });
});

// The one clamp: shownOpenNowWidth, the drag's live width and the arrow keys
// all go through it, so none of them can round or clamp differently.
describe('clampOpenNowWidth', () => {
  it('rounds a fractional width to whole px', () => {
    expect(clampOpenNowWidth(500.4, 1600)).toBe(500);
    expect(clampOpenNowWidth(500.6, 1600)).toBe(501);
  });

  it("clamps to this window's limits", () => {
    expect(clampOpenNowWidth(200, 1600)).toBe(300);
    expect(clampOpenNowWidth(2000, 1600)).toBe(764);
    expect(clampOpenNowWidth(700, 1280)).toBe(444);
  });

  it('shownOpenNowWidth rounds through it', () => {
    expect(shownOpenNowWidth(500.6, 1600)).toBe(501);
  });
});

describe('every width is a whole px', () => {
  // A fractional px track can shift the drag engine's row geometry by
  // sub-pixels (memory: derive-the-box-dont-approximate-it).
  it('default, min and max are integers across 1100..3000', () => {
    for (let w = 1100; w <= 3000; w++) {
      expect(Number.isInteger(defaultOpenNowWidth(w))).toBe(true);
      const { min, max } = openNowWidthLimits(w);
      expect(Number.isInteger(min)).toBe(true);
      expect(Number.isInteger(max)).toBe(true);
    }
  });
});
