import { describe, expect, it } from 'vitest';
import { placeMenu } from './placeMenu';

const VIEWPORT = { width: 790, height: 550 };
const MENU = { width: 180, height: 150 };

describe('placeMenu', () => {
  it('fits: top-left at the pointer', () => {
    expect(placeMenu({ x: 100, y: 100 }, MENU, VIEWPORT)).toEqual({ left: 100, top: 100 });
  });

  it('right edge: flips left', () => {
    expect(placeMenu({ x: 700, y: 100 }, MENU, VIEWPORT)).toEqual({ left: 520, top: 100 });
  });

  it('bottom edge: flips up', () => {
    expect(placeMenu({ x: 100, y: 500 }, MENU, VIEWPORT)).toEqual({ left: 100, top: 350 });
  });

  it('corner: flips both', () => {
    expect(placeMenu({ x: 700, y: 500 }, MENU, VIEWPORT)).toEqual({ left: 520, top: 350 });
  });

  it('taller than the window: top edge wins at the gutter', () => {
    expect(placeMenu({ x: 100, y: 300 }, { width: 180, height: 600 }, VIEWPORT)).toEqual({
      left: 100,
      top: 4,
    });
  });

  it('wider than room both ways: clamped inside the gutter', () => {
    expect(placeMenu({ x: 400, y: 100 }, { width: 780, height: 100 }, VIEWPORT)).toEqual({
      left: 6,
      top: 100,
    });
  });
});
