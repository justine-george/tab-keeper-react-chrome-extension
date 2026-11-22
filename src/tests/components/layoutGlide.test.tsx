import { describe, expect, it } from 'vitest';

import {
  clipAboveLine,
  ownShifts,
  uncoveredAt,
} from '../../components/common/layoutGlide';

// KAN-984. The two sums a fold's or delete's glide is drawn from.

describe('ownShifts', () => {
  const parents: Record<string, string | null> = {
    block: null,
    band: 'block',
    row: 'band',
    loose: 'block',
  };
  const parentOf = (el: string) => parents[el] ?? null;

  it('takes off what a gliding element around it already carries', () => {
    const own = ownShifts(
      new Map([
        ['block', 40],
        ['band', 40],
        ['row', 72],
      ]),
      parentOf
    );
    expect([...own]).toEqual([
      ['block', 40],
      ['row', 32],
    ]);
  });

  it('skips a still parent and subtracts the nearest one that moves', () => {
    const own = ownShifts(
      new Map([
        ['block', 30],
        ['band', 0],
        ['row', 30],
      ]),
      parentOf
    );
    expect([...own]).toEqual([['block', 30]]);
  });

  it('leaves out moves under a pixel', () => {
    expect([...ownShifts(new Map([['loose', 0.6]]), parentOf)]).toEqual([]);
  });
});

describe('clipAboveLine', () => {
  const insets = (frames: Keyframe[] | null) =>
    frames?.map((f) => [f.offset, f.clipPath]);

  it('closing: a row the line rises over shows less and less of itself', () => {
    // The row at 100-132; the rows below rise from 132 to 100.
    expect(insets(clipAboveLine(100, 132, 132, 100))).toEqual([
      [0, 'inset(0 0 0px 0)'],
      [1, 'inset(0 0 32px 0)'],
    ]);
  });

  it('closing: a region taller than the travel is cut only once the line reaches it', () => {
    // A folded group's rows at 100-196; the rows below rise from 196 to 100.
    expect(insets(clipAboveLine(100, 196, 196, 100))).toEqual([
      [0, 'inset(0 0 0px 0)'],
      [1, 'inset(0 0 96px 0)'],
    ]);
    // Its second half (148-196) is gone by halfway.
    expect(insets(clipAboveLine(148, 196, 196, 100))).toEqual([
      [0, 'inset(0 0 0px 0)'],
      [0.5, 'inset(0 0 48px 0)'],
      [1, 'inset(0 0 48px 0)'],
    ]);
  });

  it('opening: a returning row is uncovered as the line falls past it', () => {
    // The row back at 132-164, under one at 100-132; the rows below fall from 132 to 196.
    expect(insets(clipAboveLine(132, 164, 132, 196))).toEqual([
      [0, 'inset(0 0 32px 0)'],
      [0.5, 'inset(0 0 0px 0)'],
      [1, 'inset(0 0 0px 0)'],
    ]);
  });

  it('is null when the line never crosses the region, or does not move', () => {
    expect(clipAboveLine(100, 132, 200, 150)).toBeNull();
    expect(clipAboveLine(100, 132, 120, 120)).toBeNull();
    expect(clipAboveLine(100, 100, 132, 100)).toBeNull();
  });
});

describe('uncoveredAt', () => {
  it('is 0 for a row the line starts past, or a line that does not move', () => {
    expect(uncoveredAt(100, 132, 196)).toBe(0);
    expect(uncoveredAt(150, 132, 132)).toBe(0);
  });

  it('waits for the rows gliding down to all but pass a returning row', () => {
    // EASE.OUT covers half the way in about a tenth of the time, nine tenths in about a third.
    const half = uncoveredAt(164, 132, 196);
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(0.15);
    const last = uncoveredAt(196, 132, 196);
    expect(last).toBeGreaterThan(0.25);
    expect(last).toBeLessThan(0.45);
    // Past 90% of the way it waits no longer.
    expect(uncoveredAt(300, 132, 196)).toBeCloseTo(last, 5);
  });
});
