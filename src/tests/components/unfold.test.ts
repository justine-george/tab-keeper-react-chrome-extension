import { describe, expect, test } from 'vitest';

import {
  afterUnfold,
  type Measured,
  type Rect,
  type Slot,
  type Unfold,
} from '../../components/home/rightpane/rowDrag/unfold';

// KAN-379. A window the drag measured folded opens mid-drag: the snapshot is
// patched, never re-measured. Content space, rows 20 tall, windows 20 apart.
//
//   both open                 both folded
//   w1   10..50  a0 30        w1   10..50  a0 30
//   w2   70..150 b0 90,       w2   70..90
//        gb 110, b1 130,      w3  110..150 c0 130
//        gb:tail 150          w4  170..190
//   w3  170..210 c0 190       last 210..230
//   w4  230..290 d0 250, d1 270
//   last 310..330
//
// So w2 grows by 60 and w4 by 40.

const EDGES = { left: 0, right: 200 };
const MEMBER = { left: 16, right: 200 };

const row = (
  id: string,
  index: number,
  top: number,
  windowId: string,
  bandId?: string
): Rect => ({
  id,
  index,
  top,
  mid: top + 10,
  height: 20,
  windowId,
  edges: bandId === undefined ? EDGES : MEMBER,
  bandId,
});

// A row of a window that was folded when measured.
const unmeasured = (id: string, index: number): Rect => ({
  id,
  index,
  top: 0,
  mid: 0,
  height: 0,
  windowId: undefined,
  edges: { left: 0, right: 0 },
  bandId: undefined,
});

const FOLDED: Measured = {
  rects: [
    row('a0', 0, 30, 'w1'),
    unmeasured('b0', 1),
    unmeasured('b1', 2),
    row('c0', 3, 130, 'w3'),
    unmeasured('d0', 4),
    unmeasured('d1', 5),
  ],
  fixed: [],
  windowTops: new Map([
    ['w1', 10],
    ['w2', 70],
    ['w3', 110],
    ['w4', 170],
    ['last', 210],
  ]),
  windowBottoms: new Map([
    ['w1', 50],
    ['w2', 90],
    ['w3', 150],
    ['w4', 190],
    ['last', 230],
  ]),
  listTops: new Map([
    ['w1', 30],
    ['w3', 130],
  ]),
  maxScroll: 100,
};

// Measured with both open, but for w2's and w4's list tops, which an unfold
// does not read (see afterUnfold).
const BOTH_OPEN: Measured = {
  rects: [
    row('a0', 0, 30, 'w1'),
    row('b0', 1, 90, 'w2'),
    row('b1', 2, 130, 'w2', 'gb'),
    row('c0', 3, 190, 'w3'),
    row('d0', 4, 250, 'w4'),
    row('d1', 5, 270, 'w4'),
  ],
  fixed: [
    { key: 'gb', top: 110, height: 20, windowId: 'w2' },
    { key: 'gb:tail', top: 150, height: 0, windowId: 'w2' },
  ],
  windowTops: new Map([
    ['w1', 10],
    ['w2', 70],
    ['w3', 170],
    ['w4', 230],
    ['last', 310],
  ]),
  windowBottoms: new Map([
    ['w1', 50],
    ['w2', 150],
    ['w3', 210],
    ['w4', 290],
    ['last', 330],
  ]),
  listTops: new Map([
    ['w1', 30],
    ['w3', 190],
  ]),
  maxScroll: 200,
};

const W2_FIXED: Unfold['fixed'] = [
  { key: 'gb', top: 110, height: 20 },
  { key: 'gb:tail', top: 150, height: 0 },
];
const openW2: Unfold = {
  windowId: 'w2',
  growth: 60,
  rows: [
    { id: 'b0', top: 90, height: 20, edges: EDGES, bandId: undefined },
    { id: 'b1', top: 130, height: 20, edges: MEMBER, bandId: 'gb' },
  ],
  fixed: W2_FIXED,
};
// w4's rows as read with w2 already open, and with w2 still folded.
const openW4 = (top: number): Unfold => ({
  windowId: 'w4',
  growth: 40,
  rows: [
    { id: 'd0', top, height: 20, edges: EDGES, bandId: undefined },
    { id: 'd1', top: top + 20, height: 20, edges: EDGES, bandId: undefined },
  ],
  fixed: [],
});

const byTop = (fixed: Slot[]) => [...fixed].sort((a, b) => a.top - b.top);

describe('afterUnfold', () => {
  const next = afterUnfold(FOLDED, openW2);
  const rect = (id: string) => next.rects.find((r) => r.id === id);

  test('leaves everything above the window untouched', () => {
    expect(rect('a0')).toEqual(row('a0', 0, 30, 'w1'));
    expect(next.windowTops.get('w1')).toBe(10);
    expect(next.windowBottoms.get('w1')).toBe(50);
    expect(next.listTops.get('w1')).toBe(30);
  });

  test("fills in the window's rows at the tops given, with its window id", () => {
    expect(rect('b0')).toEqual(row('b0', 1, 90, 'w2'));
    expect(rect('b1')).toEqual(row('b1', 2, 130, 'w2', 'gb'));
    expect(byTop(next.fixed)).toEqual([
      { key: 'gb', top: 110, height: 20, windowId: 'w2' },
      { key: 'gb:tail', top: 150, height: 0, windowId: 'w2' },
    ]);
  });

  test('moves everything below the window by exactly its growth', () => {
    expect(rect('c0')).toEqual(row('c0', 3, 190, 'w3'));
    expect(next.windowTops.get('w3')).toBe(170);
    expect(next.windowBottoms.get('w3')).toBe(210);
    expect(next.windowTops.get('w4')).toBe(230);
    expect(next.windowBottoms.get('w4')).toBe(250);
    expect(next.windowTops.get('last')).toBe(270);
    expect(next.windowBottoms.get('last')).toBe(290);
    expect(next.listTops.get('w3')).toBe(190);
  });

  test("moves the window's own bottom and the scroll limit by its growth, not its top", () => {
    expect(next.windowTops.get('w2')).toBe(70);
    expect(next.windowBottoms.get('w2')).toBe(150);
    expect(next.maxScroll).toBe(160);
  });

  test("leaves another folded window's rows unmeasured", () => {
    expect(rect('d0')).toEqual(unmeasured('d0', 4));
    expect(rect('d1')).toEqual(unmeasured('d1', 5));
  });

  test('two opens compose: the second below the first', () => {
    const both = afterUnfold(afterUnfold(FOLDED, openW2), openW4(250));
    expect(both.rects).toEqual(BOTH_OPEN.rects);
    expect(byTop(both.fixed)).toEqual(BOTH_OPEN.fixed);
    expect(both.windowTops).toEqual(BOTH_OPEN.windowTops);
    expect(both.windowBottoms).toEqual(BOTH_OPEN.windowBottoms);
    expect(both.listTops).toEqual(BOTH_OPEN.listTops);
    expect(both.maxScroll).toBe(BOTH_OPEN.maxScroll);
  });

  test('two opens compose: the second above the first', () => {
    const both = afterUnfold(afterUnfold(FOLDED, openW4(190)), openW2);
    expect(both.rects).toEqual(BOTH_OPEN.rects);
    expect(byTop(both.fixed)).toEqual(BOTH_OPEN.fixed);
    expect(both.windowTops).toEqual(BOTH_OPEN.windowTops);
    expect(both.windowBottoms).toEqual(BOTH_OPEN.windowBottoms);
    expect(both.listTops).toEqual(BOTH_OPEN.listTops);
    expect(both.maxScroll).toBe(BOTH_OPEN.maxScroll);
  });

  test('a window the snapshot never measured changes nothing', () => {
    expect(afterUnfold(FOLDED, { ...openW2, windowId: 'w9' })).toBe(FOLDED);
  });

  test('never mutates the snapshot it is given', () => {
    const before = structuredClone(FOLDED);
    afterUnfold(FOLDED, openW2);
    expect(FOLDED).toEqual(before);
  });
});
