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
