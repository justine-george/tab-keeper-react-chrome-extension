import { describe, expect, it } from 'vitest';

import {
  announceArrival,
  arrivalBox,
  arrivalRuns,
  nearestScroll,
  subscribeArrival,
} from '../../../utils/functions/arrival';

// A box's edges at (left, top), `height` tall and `width` wide.
const r = (left: number, top: number, height: number, width = 300) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

// KAN-892. A saved window dropped on an open window: the worker's tab ids are
// told to whoever listens (Open now's scroll and fill, Task 5).
describe('arrival', () => {
  it('tells every listener the window and its new tab ids', () => {
    const heard: unknown[] = [];
    const heardToo: unknown[] = [];
    const stop = subscribeArrival((a) => heard.push(a));
    const stopToo = subscribeArrival((a) => heardToo.push(a));

    announceArrival(7, [71, 72]);

    expect(heard).toEqual([{ windowId: 7, tabIds: [71, 72] }]);
    expect(heardToo).toEqual([{ windowId: 7, tabIds: [71, 72] }]);
    stop();
    stopToo();
  });

  it('a listener that stopped hears nothing more; the others still do', () => {
    const heard: unknown[] = [];
    const heardToo: unknown[] = [];
    const stop = subscribeArrival((a) => heard.push(a));
    const stopToo = subscribeArrival((a) => heardToo.push(a));

    stop();
    announceArrival(7, [71]);

    expect(heard).toEqual([]);
    expect(heardToo).toEqual([{ windowId: 7, tabIds: [71] }]);
    stopToo();
  });

  it('with no listener, an announcement goes nowhere and throws nothing', () => {
    expect(() => announceArrival(7, [71])).not.toThrow();
  });
});

// KAN-892 D. The one fill behind a dropped window's new rows, in its block.
describe('arrivalBox', () => {
  it("arrivalBox spans the first new row to the last, the rows' left edge, 4px in from the right", () => {
    expect(
      arrivalBox([r(110, 200, 32), r(140, 232, 64)], r(0, 100, 400, 800))
    ).toEqual({ top: 100, height: 96, left: 110, right: 4 });
  });

  it('a group band further left than the rows sets the left edge', () => {
    expect(
      arrivalBox([r(110, 200, 32), r(90, 236, 70)], r(10, 100, 400, 800))
    ).toEqual({ top: 100, height: 106, left: 80, right: 4 });
  });
});

// R17. One fill per run of new rows next to each other in the block: pinned
// tabs join the pinned run, the rest the end, so old rows can sit between.
describe('arrivalRuns', () => {
  const isNew = (ids: number[]) => (id: number) => ids.includes(id);

  it('new rows all together: one run', () => {
    expect(arrivalRuns([1, 2, 3, 4], isNew([3, 4]))).toEqual([[3, 4]]);
  });

  it('a pinned run and a tail with old rows between: two runs, in order', () => {
    expect(arrivalRuns([9, 1, 2, 3, 4], isNew([9, 3, 4]))).toEqual([
      [9],
      [3, 4],
    ]);
  });

  it('old rows on both sides of each run are in neither', () => {
    expect(arrivalRuns([1, 9, 2, 3, 4], isNew([9, 4]))).toEqual([[9], [4]]);
  });

  it('nothing new: no runs', () => {
    expect(arrivalRuns([1, 2], isNew([]))).toEqual([]);
  });
});

// The least scroll that shows the new rows, 8px clear of the list's edges
// (the approved mock's), the first new row winning when they don't fit.
describe('nearestScroll', () => {
  const view = { top: 100, bottom: 500 };

  it('rows in view: no scroll', () => {
    expect(nearestScroll({ top: 200, bottom: 300 }, view)).toBe(0);
  });

  it('rows below: down just far enough to show the last of them', () => {
    expect(nearestScroll({ top: 450, bottom: 600 }, view)).toBe(108);
  });

  it('rows above: up just far enough to show the first of them', () => {
    expect(nearestScroll({ top: 50, bottom: 120 }, view)).toBe(-58);
  });

  it('rows taller than the list: the first new row at the top', () => {
    expect(nearestScroll({ top: 450, bottom: 1000 }, view)).toBe(342);
    expect(nearestScroll({ top: 50, bottom: 1000 }, view)).toBe(-58);
  });
});
