import { afterEach, describe, expect, test } from 'vitest';

import { rowsBox } from '../../components/tour/anchorBox';
import type { Box } from '../../components/tour/coachMarkPlacement';

// Measured at 1280x380, root 20px: scroll box 365,135,462x236, client 366,136,460x234.

const rect = ({ left, top, width, height }: Box): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});

let scroller: HTMLElement | null = null;
afterEach(() => {
  scroller?.remove();
  scroller = null;
});

// The scroll box with its 1px border, holding the anchor and these rows.
function windowsAnchor(rows: readonly Box[]): HTMLElement {
  const box = document.createElement('div');
  box.getBoundingClientRect = () =>
    rect({ left: 365, top: 135, width: 462, height: 236 });
  for (const [name, value] of [
    ['clientLeft', 1],
    ['clientTop', 1],
    ['clientWidth', 460],
    ['clientHeight', 234],
  ] as const) {
    Object.defineProperty(box, name, { value });
  }
  const anchor = document.createElement('div');
  for (const row of rows) {
    const element = document.createElement('div');
    element.setAttribute('data-drag-row-id', '');
    element.getBoundingClientRect = () => rect(row);
    anchor.append(element);
  }
  box.append(anchor);
  document.body.append(box);
  scroller = box;
  return anchor;
}
// The sample's two windows, 274px together, the first row's top at `top`.
const windowsAt = (top: number): Box[] => [
  { left: 366, top, width: 460, height: 120 },
  { left: 366, top: top + 128, width: 460, height: 146 },
];

describe('rowsBox', () => {
  test('rows that fit the box are ringed whole', () => {
    const rows = { left: 366, top: 140, width: 460, height: 100 };
    expect(rowsBox(windowsAnchor([rows]))).toEqual(rows);
  });

  test('as the step starts, the rows are clipped at the box’s bottom, inside its border', () => {
    expect(rowsBox(windowsAnchor(windowsAt(136)))).toEqual({
      left: 366,
      top: 136,
      width: 460,
      height: 234,
    });
  });

  test('scrolled 48px, they are clipped at the box’s top', () => {
    expect(rowsBox(windowsAnchor(windowsAt(88)))).toEqual({
      left: 366,
      top: 136,
      width: 460,
      height: 226,
    });
  });

  test('scrolled wholly out of the box, there is no box: the step is unplaced', () => {
    expect(rowsBox(windowsAnchor(windowsAt(400)))).toBeNull();
  });
});
