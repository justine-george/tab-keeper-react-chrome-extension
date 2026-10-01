import { describe, expect, test } from 'vitest';
import { windowBlockAt } from '../../components/home/rightpane/rowDrag/dropRules';

const box = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    height,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

function pane(blocks: [string, number, number][]) {
  const root = document.createElement('div');
  for (const [id, top, height] of blocks) {
    const el = document.createElement('div');
    el.setAttribute('data-drop-window-id', id);
    el.getBoundingClientRect = () => box(top, height);
    root.appendChild(el);
  }
  return root;
}

describe('windowBlockAt', () => {
  const root = pane([
    ['wA', 0, 142],
    ['wB', 180, 122],
  ]);
  const at = (y: number) =>
    windowBlockAt(root, 10, y)?.getAttribute('data-drop-window-id') ?? null;

  test('inside a block', () => {
    expect(at(100)).toBe('wA');
    expect(at(200)).toBe('wB');
  });
  test('the gap goes to the nearer block', () => {
    expect(at(150)).toBe('wA');
    expect(at(160)).toBe('wA');
    expect(at(161)).toBe('wA');
    expect(at(162)).toBe('wB');
    expect(at(175)).toBe('wB');
  });
  test('outside every block', () => {
    expect(at(400)).toBeNull();
    expect(windowBlockAt(root, 900, 160)).toBeNull();
  });
});

// KAN-361/366. The trailing block after the last window -- where a carried
// tab's or group's phantom rests, a row tall during a tab or group drag --
// and, below the last window, the one exception to "below the last block
// names no window" (KAN-366 B).
describe('windowBlockAt and the trailing block', () => {
  const root = pane([
    ['wA', 0, 142],
    ['wB', 180, 122],
    ['new-window:last', 310, 34],
  ]);
  const trailing = root.lastElementChild;
  if (!(trailing instanceof HTMLElement)) throw new Error('no trailing block');
  trailing.dataset.newWindowTarget = 'last';
  const at = (y: number) =>
    windowBlockAt(root, 10, y)?.getAttribute('data-drop-window-id') ?? null;

  // KAN-366 B: below the last window, inside the trailing block's own left
  // and right, a point is the trailing block -- the whole empty space, past
  // its own box too.
  test('a point on it, or anywhere below it, is the trailing block', () => {
    expect(at(310)).toBe('new-window:last');
    expect(at(320)).toBe('new-window:last');
    expect(at(900)).toBe('new-window:last');
  });
  test('beside it, below the last window, names no window', () => {
    expect(windowBlockAt(root, 201, 320)).toBeNull();
    expect(windowBlockAt(root, -1, 320)).toBeNull();
    // CONTROL: at its edges, it is.
    expect(windowBlockAt(root, 200, 320)).toBe(trailing);
    expect(windowBlockAt(root, 0, 320)).toBe(trailing);
  });
  // From the last window's bottom, not the block's own top: the gap between
  // them is no band of its own, where a row of another window would be
  // refused and its landing snap home (KAN-185's defect).
  test('the gap above it is the trailing block’s, from the last window’s bottom', () => {
    expect(at(303)).toBe('new-window:last');
    expect(at(308)).toBe('new-window:last');
    // CONTROL: the last window's own bottom edge is the last window.
    expect(at(302)).toBe('wB');
  });
  // The last window moved down by a preview (KAN-184): the space begins
  // where it rests. Growing a preview must not move what the pointer can
  // hit.
  test('the last window shifted down by a preview: the space begins at its resting bottom', () => {
    const shifted = pane([
      ['wA', 0, 142],
      ['wB', 180 + 34, 122],
      ['new-window:last', 310 + 34, 34],
    ]);
    const [wB, block] = [...shifted.children].slice(1);
    if (!(wB instanceof HTMLElement) || !(block instanceof HTMLElement))
      throw new Error('no blocks');
    wB.dataset.windowShift = '34';
    block.dataset.windowShift = '34';
    block.dataset.newWindowTarget = 'last';
    const atShifted = (y: number) =>
      windowBlockAt(shifted, 10, y)?.getAttribute('data-drop-window-id') ??
      null;
    expect(atShifted(303)).toBe('new-window:last');
    expect(atShifted(302)).toBe('wB');
  });
  test('CONTROL: the same block unmarked is a window, and takes the gap', () => {
    const plain = pane([
      ['wA', 0, 142],
      ['wB', 180, 122],
      ['wC', 310, 34],
    ]);
    const atPlain = (y: number) =>
      windowBlockAt(plain, 10, y)?.getAttribute('data-drop-window-id') ?? null;
    expect(atPlain(320)).toBe('wC');
    expect(atPlain(308)).toBe('wC');
  });
});
