import { describe, expect, test } from 'vitest';

import {
  clipPathWithHoles,
  sameCorners,
  intersectBox,
  placeBeside,
  placeFree,
  placeInPopupPane,
  ringBox,
  sameFrame,
  unionBox,
  type Box,
  type CoachPlacement,
  type Size,
} from '../../components/tour/coachMarkPlacement';

// Numbers from the two mocks (popup 790x550, full view 1280x800) and the measured windows content.

const POPUP_VIEW = { width: 790, height: 550 };
const FULL_VIEW = { width: 1280, height: 800 };
const POPUP_MARK = { width: 290, height: 140 };
const FULL_MARK = { width: 300, height: 150 };
const STEP_1 = ['right', 'left', 'below'] as const;
const STEP_2 = ['below', 'right', 'left'] as const;
const STEP_4 = ['below', 'left', 'right'] as const;

const overlaps = (anchor: Box, mark: Size, p: CoachPlacement) =>
  p.left < anchor.left + anchor.width &&
  p.left + mark.width > anchor.left &&
  p.top < anchor.top + anchor.height &&
  p.top + mark.height > anchor.top;

describe('placeInPopupPane', () => {
  test('at 40px in the left pane, the notch on its right edge at the anchor’s middle', () => {
    expect(
      placeInPopupPane(
        { left: 393, top: 78, width: 40, height: 40 },
        POPUP_MARK,
        POPUP_VIEW
      )
    ).toEqual({ side: 'left', left: 40, top: 28, notch: 70 });
  });

  test('near the top it is clamped, and the notch still aims at the anchor', () => {
    expect(
      placeInPopupPane(
        { left: 361, top: 6, width: 204, height: 40 },
        POPUP_MARK,
        POPUP_VIEW
      )
    ).toEqual({ side: 'left', left: 40, top: 8, notch: 18 });
  });

  test('moves left rather than reach an anchor close to the pane', () => {
    expect(
      placeInPopupPane(
        { left: 340, top: 200, width: 100, height: 40 },
        POPUP_MARK,
        POPUP_VIEW
      ).left
    ).toBe(22);
  });

  test('near the bottom it is clamped, and the notch stays on the mark', () => {
    expect(
      placeInPopupPane(
        { left: 361, top: 520, width: 200, height: 20 },
        POPUP_MARK,
        POPUP_VIEW
      )
    ).toEqual({ side: 'left', left: 40, top: 402, notch: 126 });
  });
});

describe('placeBeside', () => {
  test('step 1: right of the windows content, the notch at its middle', () => {
    expect(
      placeBeside(
        { left: 366, top: 124, width: 460, height: 240 },
        FULL_MARK,
        FULL_VIEW,
        STEP_1
      )
    ).toEqual({ side: 'right', left: 854, top: 169, notch: 75 });
  });

  test('too narrow on the right, it turns left', () => {
    expect(
      placeBeside(
        { left: 366, top: 124, width: 460, height: 240 },
        FULL_MARK,
        { width: 1000, height: 800 },
        STEP_1
      )
    ).toEqual({ side: 'left', left: 38, top: 169, notch: 75 });
  });

  test('step 2: below the Open button, the notch at its middle', () => {
    expect(
      placeBeside(
        { left: 394, top: 78, width: 40, height: 40 },
        FULL_MARK,
        FULL_VIEW,
        STEP_2
      )
    ).toEqual({ side: 'below', left: 390, top: 132, notch: 24 });
  });

  test('a wide anchor is aimed 46px in, not at its middle', () => {
    expect(
      placeBeside(
        { left: 362, top: 6, width: 204, height: 40 },
        FULL_MARK,
        FULL_VIEW,
        STEP_2
      )
    ).toEqual({ side: 'below', left: 384, top: 60, notch: 24 });
  });

  test('too low for below, it turns right', () => {
    expect(
      placeBeside(
        { left: 394, top: 700, width: 40, height: 40 },
        FULL_MARK,
        FULL_VIEW,
        STEP_2
      )
    ).toEqual({ side: 'right', left: 462, top: 642, notch: 78 });
  });

  test('nowhere fits: the first side, clamped inside the window', () => {
    expect(
      placeBeside(
        { left: 50, top: 50, width: 300, height: 200 },
        FULL_MARK,
        { width: 400, height: 300 },
        STEP_1
      )
    ).toEqual({ side: 'right', left: 92, top: 75, notch: 75 });
  });

  test('the notch never leaves the mark', () => {
    expect(
      placeBeside(
        { left: 1250, top: 100, width: 20, height: 20 },
        FULL_MARK,
        FULL_VIEW,
        STEP_2
      )
    ).toEqual({ side: 'below', left: 972, top: 134, notch: 286 });
  });

  test.each([
    [
      'the windows content',
      { left: 366, top: 124, width: 460, height: 240 },
      STEP_1,
    ],
    ['the Open button', { left: 394, top: 78, width: 40, height: 40 }, STEP_2],
    ['the title', { left: 362, top: 6, width: 204, height: 40 }, STEP_2],
    ['the first tab', { left: 432, top: 152, width: 398, height: 40 }, STEP_2],
    ['Delete session', { left: 427, top: 179, width: 186, height: 42 }, STEP_1],
  ] as const)('covers none of %s', (_name, anchor, sides) => {
    expect(
      overlaps(
        anchor,
        FULL_MARK,
        placeBeside(anchor, FULL_MARK, FULL_VIEW, sides)
      )
    ).toBe(false);
  });
});

describe('placeBeside with a bright box larger than the anchor', () => {
  const tab = { left: 432, top: 152, width: 398, height: 40 };
  const lit = { left: 432, top: 152, width: 398, height: 210 };
  const tall = { width: 1280, height: 450 };

  test('below is measured from the bright box’s bottom, the notch still aims at the anchor', () => {
    const p = placeBeside(tab, FULL_MARK, FULL_VIEW, STEP_4, lit);
    expect(p).toEqual({ side: 'below', left: 454, top: 376, notch: 24 });
    expect(overlaps(lit, FULL_MARK, p)).toBe(false);
  });

  test('too low for below, it goes left of the bright box, the notch clamped to the mark', () => {
    const p = placeBeside(tab, FULL_MARK, tall, STEP_4, lit);
    expect(p).toEqual({ side: 'left', left: 104, top: 182, notch: 14 });
    expect(overlaps(lit, FULL_MARK, p)).toBe(false);
  });

  test('no room on the left either, it goes right of the bright box', () => {
    const edge = { ...lit, left: 60 };
    const p = placeBeside({ ...tab, left: 60 }, FULL_MARK, tall, STEP_4, edge);
    expect(p).toEqual({ side: 'right', left: 486, top: 182, notch: 14 });
    expect(overlaps(edge, FULL_MARK, p)).toBe(false);
  });
});

describe('unionBox', () => {
  test('the smallest box holding every drawn box', () => {
    expect(
      unionBox([
        { left: 366, top: 124, width: 460, height: 120 },
        { left: 366, top: 252, width: 460, height: 112 },
      ])
    ).toEqual({ left: 366, top: 124, width: 460, height: 240 });
  });
  test('a box with no size is not drawn, and none drawn is null', () => {
    const row = { left: 10, top: 10, width: 100, height: 40 };
    expect(unionBox([row, { left: 0, top: 900, width: 0, height: 0 }])).toEqual(
      row
    );
    expect(unionBox([{ left: 0, top: 0, width: 100, height: 0 }])).toBeNull();
    expect(unionBox([])).toBeNull();
  });
});

// The windows box measured at 1280x380, root 20px: client rect 366,136,460x234.
describe('intersectBox', () => {
  const box = { left: 366, top: 136, width: 460, height: 234 };
  test('the part of a box inside another', () => {
    expect(
      intersectBox({ left: 366, top: 88, width: 460, height: 274 }, box)
    ).toEqual({
      left: 366,
      top: 136,
      width: 460,
      height: 226,
    });
  });
  test('a box wholly inside comes back unchanged', () => {
    const rows = { left: 366, top: 140, width: 460, height: 100 };
    expect(intersectBox(rows, box)).toEqual(rows);
  });
  test('no overlap, or a shared edge only, is null', () => {
    expect(
      intersectBox({ left: 366, top: 400, width: 460, height: 100 }, box)
    ).toBeNull();
    expect(
      intersectBox({ left: 366, top: 370, width: 460, height: 40 }, box)
    ).toBeNull();
  });
});

describe('ringBox', () => {
  test('RING_INSET outside the box on every side', () => {
    expect(ringBox({ left: 400, top: 100, width: 200, height: 40 })).toEqual({
      left: 396,
      top: 96,
      width: 208,
      height: 48,
    });
  });
});

// A hole's subpaths, each as its points in order (the outer rectangle dropped).
const holePoints = (path: string): [number, number][][] => {
  const body = /^path\(evenodd, "M0 0H100000V100000H0Z(.*)"\)$/.exec(path);
  if (body === null) throw new Error(`not a dim path: ${path}`);
  return body[1]
    .split('M')
    .slice(1)
    .map((sub) => {
      const points: [number, number][] = [];
      let [x, y] = [0, 0];
      for (const [, op, a, b] of sub.matchAll(
        /([MLHVZ]?)\s*(-?[\d.]+)?(?:\s+(-?[\d.]+))?/g
      )) {
        if (a === undefined) continue;
        if (op === 'H') x = Number(a);
        else if (op === 'V') y = Number(a);
        else [x, y] = [Number(a), Number(b)];
        points.push([x, y]);
      }
      return points;
    });
};

// KAN-901. The ring is a 12px squircle RING_INSET out; the hole is its shape
// brought in, so the lit thing's 8px squircle corner sits inside it whole.
describe('clipPathWithHoles: a squircle hole', () => {
  const box = { left: 396, top: 96, width: 208, height: 48.5 };
  const [points] = holePoints(
    clipPathWithHoles([{ box, corners: sameCorners(8) }])
  );
  const [l, t, r, b] = [396, 96, 604, 144.5];

  test('the whole element, less the box, by the even-odd rule', () => {
    expect(clipPathWithHoles([{ box, corners: sameCorners(8) }])).toMatch(
      /^path\(evenodd, "M0 0H100000V100000H0Z M404 96H596.*Z"\)$/
    );
  });
  test('every point is inside the box, and it touches all four sides', () => {
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(l);
      expect(x).toBeLessThanOrEqual(r);
      expect(y).toBeGreaterThanOrEqual(t);
      expect(y).toBeLessThanOrEqual(b);
    }
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([l, r]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([t, b]);
  });
  test('each corner point lies on |x|^4 + |y|^4 = k^4, as CSS draws squircle', () => {
    const k = 8;
    const centres = [
      [r - k, t + k],
      [r - k, b - k],
      [l + k, b - k],
      [l + k, t + k],
    ];
    let onCurve = 0;
    for (const [x, y] of points) {
      const centre = centres.find(
        ([cx, cy]) =>
          Math.abs(x - cx) <= k &&
          Math.abs(y - cy) <= k &&
          Math.abs(x - cx) > 0 &&
          Math.abs(y - cy) > 0
      );
      if (centre === undefined) continue;
      const [cx, cy] = centre;
      const d = Math.abs(x - cx) ** 4 + Math.abs(y - cy) ** 4;
      expect(d / k ** 4).toBeCloseTo(1, 2);
      onCurve += 1;
    }
    expect(onCurve).toBeGreaterThanOrEqual(4 * 8);
  });
  test('the corner passes k(1 - 2^-1/4) in from the box corner on the diagonal, not a circle’s k(1 - 2^-1/2)', () => {
    const inset = 8 * (1 - 2 ** -0.25);
    expect(
      points.some(
        ([x, y]) =>
          Math.abs(x - (l + inset)) < 0.01 && Math.abs(y - (t + inset)) < 0.01
      )
    ).toBe(true);
  });
  test('a hole smaller than two radii caps the radius at half its side', () => {
    const [small] = holePoints(
      clipPathWithHoles([
        {
          box: { left: 0, top: 0, width: 10, height: 10 },
          corners: sameCorners(8),
        },
      ])
    );
    expect(small[0]).toEqual([5, 0]);
  });
  test('a square hole (radius 0) is the box’s rectangle', () => {
    const [square] = holePoints(
      clipPathWithHoles([
        {
          box: { left: 1, top: 2, width: 3, height: 4 },
          corners: sameCorners(0),
        },
      ])
    );
    expect(new Set(square.map((p) => p.join(',')))).toEqual(
      new Set(['1,2', '4,2', '4,6', '1,6'])
    );
  });
});

// KAN-901. The save row: an 8px field on the left, the 12px save group on the right.
describe('clipPathWithHoles: each corner its own radius', () => {
  const box = { left: 9, top: 57, width: 338.5, height: 58 };
  const [points] = holePoints(
    clipPathWithHoles([{ box, corners: [8, 12, 12, 8] }])
  );
  test('the top edge runs from 8 in at the left to 12 in at the right', () => {
    expect(points[0]).toEqual([17, 57]);
    expect(points[1]).toEqual([335.5, 57]);
  });
  test('the right corners are squircles of 12, the left of 8', () => {
    const inset = (k: number) => k * (1 - 2 ** -0.25);
    const has = (x: number, y: number) =>
      points.some(
        ([px, py]) => Math.abs(px - x) < 0.01 && Math.abs(py - y) < 0.01
      );
    expect(has(347.5 - inset(12), 57 + inset(12))).toBe(true);
    expect(has(347.5 - inset(12), 115 - inset(12))).toBe(true);
    expect(has(9 + inset(8), 115 - inset(8))).toBe(true);
    expect(has(9 + inset(8), 57 + inset(8))).toBe(true);
  });
  test('square corners: the box’s rectangle', () => {
    const [square] = holePoints(
      clipPathWithHoles([{ box, corners: sameCorners(0) }])
    );
    expect(new Set(square.map((p) => p.join(',')))).toEqual(
      new Set(['9,57', '347.5,57', '347.5,115', '9,115'])
    );
  });
});

// KAN-900. Step 2's grip gets a hole of its own beside the search row's.
describe('clipPathWithHoles: more than one hole', () => {
  test('each box is a hole of its own, in order, each capped at half its side', () => {
    const holes = holePoints(
      clipPathWithHoles([
        {
          box: { left: 0, top: 0, width: 100, height: 40 },
          corners: sameCorners(8),
        },
        {
          box: { left: 200, top: 0, width: 8, height: 800 },
          corners: sameCorners(8),
        },
      ])
    );
    expect(holes).toHaveLength(2);
    expect(holes[0][0]).toEqual([8, 0]);
    expect(holes[1][0]).toEqual([204, 0]);
  });
  test('no boxes: the whole element, no hole', () => {
    expect(clipPathWithHoles([])).toBe(
      'path(evenodd, "M0 0H100000V100000H0Z")'
    );
  });
});

describe('sameFrame', () => {
  const frame = {
    kind: 'anchored' as const,
    anchor: { left: 1, top: 2, width: 3, height: 4 },
    bright: { left: 1, top: 2, width: 3, height: 4 },
    openings: [{ left: 9, top: 0, width: 2, height: 50 }],
    placement: { side: 'below' as const, left: 5, top: 6, notch: 24 },
  };
  // KAN-900. A moved or gone opening is a new frame, so the dim's holes follow it.
  test('an opening moved, added or gone is not the same', () => {
    expect(
      sameFrame(frame, {
        ...frame,
        openings: [{ left: 10, top: 0, width: 2, height: 50 }],
      })
    ).toBe(false);
    expect(sameFrame(frame, { ...frame, openings: [] })).toBe(false);
    expect(
      sameFrame(frame, {
        ...frame,
        openings: [...frame.openings, { left: 0, top: 0, width: 1, height: 1 }],
      })
    ).toBe(false);
  });
  test('equal frames, and two nulls, are the same', () => {
    expect(sameFrame(frame, { ...frame })).toBe(true);
    expect(sameFrame(null, null)).toBe(true);
  });
  test('any number moved, or one null, is not', () => {
    expect(
      sameFrame(frame, { ...frame, placement: { ...frame.placement, top: 7 } })
    ).toBe(false);
    expect(
      sameFrame(frame, { ...frame, anchor: { ...frame.anchor, width: 9 } })
    ).toBe(false);
    expect(
      sameFrame(frame, { ...frame, bright: { ...frame.bright, height: 9 } })
    ).toBe(false);
    expect(sameFrame(frame, null)).toBe(false);
  });
  const free = {
    kind: 'free' as const,
    placement: { side: 'free' as const, left: 40, top: 20 },
  };
  test('free frames: same place is the same, a moved one or an anchored one is not', () => {
    expect(sameFrame(free, { ...free })).toBe(true);
    expect(
      sameFrame(free, { ...free, placement: { ...free.placement, left: 41 } })
    ).toBe(false);
    expect(
      sameFrame(free, { ...free, placement: { ...free.placement, top: 21 } })
    ).toBe(false);
    const sameSpot = {
      ...frame,
      placement: { ...frame.placement, left: 40, top: 20 },
    };
    expect(sameFrame(free, sameSpot)).toBe(false);
    expect(sameFrame(sameSpot, free)).toBe(false);
    expect(sameFrame(free, frame)).toBe(false);
    expect(sameFrame(frame, free)).toBe(false);
    expect(sameFrame(free, null)).toBe(false);
  });
});

describe('placeFree', () => {
  // KAN-755: no notch, so nothing about the card depends on where Chrome draws its tabs.
  test('40px in and 20px down', () => {
    expect(placeFree(POPUP_MARK, POPUP_VIEW)).toEqual({
      side: 'free',
      left: 40,
      top: 20,
    });
  });

  test('a narrow window keeps the card inside its gutter', () => {
    expect(
      placeFree({ width: 300, height: 150 }, { width: 320, height: 500 })
    ).toMatchObject({ left: 12, top: 20 });
    expect(
      placeFree({ width: 400, height: 150 }, { width: 320, height: 500 })
    ).toMatchObject({ left: 8 });
  });
});
