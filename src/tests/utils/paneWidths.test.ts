import { describe, expect, it } from 'vitest';

import {
  clampToRange,
  defaultListWidth,
  defaultOpenNowWidth,
  isListResizable,
  isOpenNowResizable,
  paneWidths,
} from '../../components/home/paneWidths';

// KAN-321 O1/O1a and KAN-687. Every width in the tab view's grid -- the saved
// list's and Open now's -- from the window's width, the fold and the widths
// the user chose. Pure, so the grid, both grips' aria values and their arrow
// keys all read the same numbers.

const NONE = { list: null, openNow: null };

describe('defaultListWidth (KAN-687: a quarter of the window, 356..520)', () => {
  it.each([
    [1100, 356],
    [1280, 356],
    [1424, 356],
    [1428, 357],
    [1440, 360],
    [1680, 420],
    [1920, 480],
    [2080, 520],
    [2560, 520],
  ])('at %ipx wide -> %ipx', (viewportWidth, expected) => {
    expect(defaultListWidth(viewportWidth)).toBe(expected);
  });
});

describe("defaultOpenNowWidth (D1: an even split of what the list's default leaves)", () => {
  it.each([
    [1100, 340],
    [1176, 340],
    [1177, 341],
    [1280, 444],
    [1440, 540],
    [1600, 600],
    [1680, 630],
    [1920, 720],
    [2560, 1020],
  ])('at %ipx wide -> %ipx', (viewportWidth, expected) => {
    expect(defaultOpenNowWidth(viewportWidth)).toBe(expected);
  });
});

describe('paneWidths with nothing chosen (the table in KAN-687 comment 11082)', () => {
  it.each([
    // [viewport, list, list min..max, Open now, Open now min..max]
    [1280, 356, 356, 356, 444, 444, 444],
    [1440, 360, 356, 420, 540, 480, 600],
    [1680, 420, 356, 570, 630, 480, 780],
    [1920, 480, 356, 600, 720, 480, 960],
    [2560, 520, 356, 600, 1020, 480, 1560],
  ])(
    'side by side at %ipx: list %i (%i..%i), Open now %i (%i..%i)',
    (viewportWidth, list, listMin, listMax, openNow, onMin, onMax) => {
      expect(paneWidths(viewportWidth, false, NONE)).toEqual({
        list,
        listRange: { min: listMin, max: listMax },
        openNow,
        openNowRange: { min: onMin, max: onMax },
      });
    }
  );

  // Folded, Open now sits in the saved session's column and keeps 480.
  it.each([
    [1100, 356, 600],
    [1280, 356, 600],
    [1440, 360, 600],
    [1920, 480, 600],
  ])('folded at %ipx: list %i, range 356..%i', (viewportWidth, list, max) => {
    const widths = paneWidths(viewportWidth, true, NONE);
    expect(widths.list).toBe(list);
    expect(widths.listRange).toEqual({ min: 356, max });
  });

  // Below 1100px the full view is the rail (side by side) or the drawer:
  // the list is today's 356 and does not resize, folded or not.
  it.each([false, true])('below 1100px the list is 356, folded %s', (folded) => {
    const widths = paneWidths(1099, folded, { list: 500, openNow: null });
    expect(widths.list).toBe(356);
    expect(widths.listRange).toEqual({ min: 356, max: 356 });
  });
});

describe('paneWidths with chosen widths', () => {
  it('a chosen list width inside its range shows unchanged', () => {
    expect(paneWidths(1920, false, { list: 555, openNow: null }).list).toBe(555);
  });

  it('the list never goes past the 600px cap', () => {
    expect(paneWidths(2560, false, { list: 900, openNow: null }).list).toBe(600);
    expect(paneWidths(1440, true, { list: 900, openNow: null }).list).toBe(600);
  });

  it('the list never goes under 356', () => {
    expect(paneWidths(1920, false, { list: 200, openNow: null }).list).toBe(356);
  });

  // Each grip's max reads the other's width (KAN-687 comment 11077).
  it("a wider Open now lowers the list's max, and a wider list lowers Open now's", () => {
    const wideOpenNow = paneWidths(1920, false, { list: null, openNow: 900 });
    expect(wideOpenNow.listRange.max).toBe(1920 - 900 - 480);
    const wideList = paneWidths(1920, false, { list: 600, openNow: null });
    expect(wideList.openNowRange.max).toBe(1920 - 600 - 480);
  });

  // Where both chosen widths no longer fit -- a narrower window, or a width
  // another page saved -- Open now keeps its width and the list gives way.
  it('when both cannot fit, Open now keeps its width and the list gives way', () => {
    const widths = paneWidths(1440, false, { list: 500, openNow: 600 });
    expect(widths.openNow).toBe(600);
    expect(widths.list).toBe(1440 - 600 - 480);
  });

  // The stored choice is never rewritten: the same chosen width comes back
  // once the window is wide enough again.
  it('the same chosen list width clamps at 1440, and is back at 1920', () => {
    const chosen = { list: 580, openNow: null };
    expect(paneWidths(1440, false, chosen).list).toBe(420);
    expect(paneWidths(1920, false, chosen).list).toBe(580);
  });
});

describe('the grips show where the window leaves a range', () => {
  it.each([
    [1100, false],
    [1316, false],
    [1317, true],
    [1600, true],
  ])('Open now at %ipx -> %s', (viewportWidth, expected) => {
    expect(isOpenNowResizable(viewportWidth)).toBe(expected);
  });

  it.each([
    [1099, false, false],
    [1099, true, false],
    [1280, false, false],
    [1280, true, true],
    [1317, false, true],
    [1920, false, true],
  ])('the list at %ipx, folded %s -> %s', (viewportWidth, folded, expected) => {
    expect(isListResizable(viewportWidth, folded)).toBe(expected);
  });
});

describe('clampToRange', () => {
  it('rounds to whole px and clamps', () => {
    expect(clampToRange(500.6, { min: 356, max: 600 })).toBe(501);
    expect(clampToRange(100, { min: 356, max: 600 })).toBe(356);
    expect(clampToRange(900, { min: 356, max: 600 })).toBe(600);
  });
});

describe('every window, every choice', () => {
  const CHOICES = [null, 200, 356, 450, 600, 900];
  const cases: [number, boolean, number | null, number | null][] = [];
  for (let w = 1100; w <= 3000; w += 7)
    for (const folded of [false, true])
      for (const list of CHOICES)
        for (const openNow of CHOICES) cases.push([w, folded, list, openNow]);

  it('every width is whole, inside its range, and the list stays 356..600', () => {
    for (const [w, folded, list, openNow] of cases) {
      const r = paneWidths(w, folded, { list, openNow });
      const at = `${w} folded=${folded} list=${list} openNow=${openNow}`;
      for (const n of [r.list, r.openNow, r.listRange.max, r.openNowRange.max])
        expect(Number.isInteger(n), at).toBe(true);
      expect(r.list, at).toBeGreaterThanOrEqual(r.listRange.min);
      expect(r.list, at).toBeLessThanOrEqual(r.listRange.max);
      expect(r.openNow, at).toBeGreaterThanOrEqual(r.openNowRange.min);
      expect(r.openNow, at).toBeLessThanOrEqual(r.openNowRange.max);
      expect(r.listRange.min, at).toBe(356);
      expect(r.listRange.max, at).toBeLessThanOrEqual(600);
    }
  });

  // The saved session keeps its 480px wherever the window can give it that.
  it('side by side above 1316px, the saved session keeps at least 480', () => {
    for (const [w, folded, list, openNow] of cases) {
      if (folded || w <= 1316) continue;
      const r = paneWidths(w, false, { list, openNow });
      expect(w - r.list - r.openNow, `${w} ${list} ${openNow}`).toBeGreaterThanOrEqual(480);
    }
  });

  // A drag ends by saving the width it shows. Saved, that width must show
  // again unchanged, with the other pane unmoved: a release never snaps.
  it('a width saved at either end of its range shows again unchanged', () => {
    for (const [w, folded, list, openNow] of cases) {
      const r = paneWidths(w, folded, { list, openNow });
      for (const end of [r.listRange.min, r.listRange.max]) {
        const again = paneWidths(w, folded, { list: end, openNow });
        expect(again.list, `list ${end} at ${w}`).toBe(end);
        expect(again.openNow, `list ${end} at ${w}`).toBe(r.openNow);
      }
      for (const end of [r.openNowRange.min, r.openNowRange.max]) {
        const again = paneWidths(w, folded, { list: r.list, openNow: end });
        expect(again.openNow, `Open now ${end} at ${w}`).toBe(end);
        expect(again.list, `Open now ${end} at ${w}`).toBe(r.list);
      }
    }
  });
});
