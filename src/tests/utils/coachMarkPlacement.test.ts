import { describe, expect, test } from 'vitest';

import {
  intersectBox,
  placeBeside,
  placeInPopupPane,
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

describe('sameFrame', () => {
  const frame = {
    anchor: { left: 1, top: 2, width: 3, height: 4 },
    placement: { side: 'below' as const, left: 5, top: 6, notch: 24 },
  };
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
    expect(sameFrame(frame, null)).toBe(false);
  });
});
