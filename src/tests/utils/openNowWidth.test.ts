import { describe, expect, it } from 'vitest';

import {
  clampOpenNowWidth,
  defaultOpenNowWidth,
  isOpenNowResizable,
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
  // Both panes keep at least 480px: Open now's min is 480, unless its
  // default is narrower, and the max leaves the saved session its 480 (never
  // below the default). At 1316px and narrower the two cannot both fit, and
  // min = max = the default.
  it.each([
    // [viewport, default, min, max]
    [1100, 340, 340, 340],
    [1280, 444, 444, 444],
    [1316, 480, 480, 480],
    [1320, 482, 480, 484],
    [1440, 542, 480, 604],
    [1600, 622, 480, 764],
    [1920, 782, 480, 1084],
    [2560, 1102, 480, 1724],
  ])(
    'at %ipx wide the default is %i, the range %i..%i',
    (viewportWidth, wanted, min, max) => {
      expect(defaultOpenNowWidth(viewportWidth)).toBe(wanted);
      expect(openNowWidthLimits(viewportWidth)).toEqual({ min, max });
    }
  );

  // L1: the default is always a width the drag can reach, and the range is
  // empty exactly where the two 480px floors cannot both fit.
  it('min <= default <= max from 1100 to 3000, and min < max exactly above 1316', () => {
    for (let w = 1100; w <= 3000; w++) {
      const { min, max } = openNowWidthLimits(w);
      const wanted = defaultOpenNowWidth(w);
      expect(min, `min at ${w}`).toBeLessThanOrEqual(wanted);
      expect(wanted, `default at ${w}`).toBeLessThanOrEqual(max);
      expect(min < max, `min < max at ${w}`).toBe(w > 1316);
    }
  });
});

// The grip's render condition (MainContainer): a range to drag through.
describe('isOpenNowResizable', () => {
  it.each([
    [1100, false],
    [1280, false],
    [1316, false],
    [1317, true],
    [1320, true],
    [1600, true],
  ])('at %ipx wide -> %s', (viewportWidth, expected) => {
    expect(isOpenNowResizable(viewportWidth)).toBe(expected);
  });
});

describe('shownOpenNowWidth', () => {
  it('null (no stored choice) shows the default', () => {
    expect(shownOpenNowWidth(null, 1600)).toBe(622);
  });

  it('a stored width inside the limits shows unchanged', () => {
    expect(shownOpenNowWidth(500, 1600)).toBe(500);
  });

  // 300 was the min before 2026-09-28; a width stored then shows as the
  // new min, 480, and is not rewritten (openNowLayout.test.tsx).
  it('a stored width below the min clamps up to it', () => {
    expect(shownOpenNowWidth(300, 1600)).toBe(480);
  });

  // Where the range is empty, every stored width shows as the default.
  it('where the range is empty, any stored width shows as the default', () => {
    expect(shownOpenNowWidth(300, 1280)).toBe(444);
    expect(shownOpenNowWidth(700, 1280)).toBe(444);
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
    expect(clampOpenNowWidth(200, 1600)).toBe(480);
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
