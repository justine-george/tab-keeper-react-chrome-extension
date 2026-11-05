import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { ICON16_GRID, icon16Pixels } from './icon16_pixels.mjs';
import { ICON_FILL, iconSvg } from './icon_palette.mjs';
import { decodePng } from './png.mjs';
import {
  TOOLBAR_16_GRID,
  TOOLBAR_INK,
  toolbar16Pixels,
} from './toolbar_icons.mjs';

// KAN-907. Chrome's icons are the mark's shape with pick B's corners, in the icons' own colours.
const GROUND = [0x87, 0xc6, 0x8e, 255];
const icon = (px) =>
  decodePng(
    readFileSync(new URL(`../public/icons/icon${px}.png`, import.meta.url))
  );

describe('the icon files', () => {
  test.each([16, 32, 48, 128])(
    'icon%i: square, corners cut away, the ground green between',
    (px) => {
      const png = icon(px);
      expect([png.width, png.height]).toEqual([px, px]);
      for (const [x, y] of [
        [0, 0],
        [px - 1, 0],
        [0, px - 1],
        [px - 1, px - 1],
      ])
        expect(png.pixel(x, y)[3]).toBe(0);
      const mid = Math.floor(px / 2);
      for (const [x, y] of [
        [mid, 0],
        [0, mid],
        [px - 1, mid],
        [mid, px - 1],
      ])
        expect(png.pixel(x, y)).toEqual(GROUND);
    }
  );

  test('icon16 is the hand-pixelled grid, nothing else', () => {
    const png = icon(16);
    const want = icon16Pixels({
      ground: ICON_FILL['#99bf9d'],
      body: ICON_FILL['#445562'],
      shadow: ICON_FILL['#253038'],
      cream: ICON_FILL['#f4eae2'],
      dark: ICON_FILL['#20292e'],
      orange: ICON_FILL['#d09263'],
    });
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) expect(png.pixel(x, y)).toEqual(want[y][x]);
  });
});

describe('the 16px grid', () => {
  test('is 16 by 16', () => {
    expect(ICON16_GRID).toHaveLength(16);
    for (const row of ICON16_GRID) expect(row).toHaveLength(16);
  });
  test('an unknown letter throws rather than drawing nothing', () => {
    const fill = {
      ground: '#000000',
      body: '#000000',
      shadow: '#000000',
      cream: '#000000',
      dark: '#000000',
      orange: '#000000',
    };
    ICON16_GRID.push('?'.repeat(16));
    try {
      expect(() => icon16Pixels(fill)).toThrow('no colour for "?"');
    } finally {
      ICON16_GRID.pop();
    }
  });
});

describe('iconSvg', () => {
  const MARK =
    '<style>.x{}</style><svg class="css-1" viewBox="0 0 128 128"><rect fill="#99bf9d" fill-opacity="0.6"></rect><path fill="#445562"></path></svg>';
  test('drops the class and the ground opacity, and recolours every fill', () => {
    expect(iconSvg(MARK)).toBe(
      '<svg viewBox="0 0 128 128"><rect fill="#87c68e"></rect><path fill="#3a576d"></path></svg>'
    );
  });
  test('a fill the icons have no colour for throws', () => {
    expect(() => iconSvg('<svg><rect fill="#123456"></rect></svg>')).toThrow(
      'no icon colour for #123456'
    );
  });
  test('markup with no svg throws', () => {
    expect(() => iconSvg('<div></div>')).toThrow('rendered no <svg>');
  });
});

// KAN-932. The toolbar's single-colour icons: pick S3, at Chrome's line weight.
describe('the toolbar icon files', () => {
  const file = (name, px) =>
    decodePng(
      readFileSync(
        new URL(`../public/icons/toolbar-${name}-${px}.png`, import.meta.url)
      )
    );

  test.each(Object.entries(TOOLBAR_INK))(
    '%s 16 is the hand-pixelled grid, nothing else',
    (name, ink) => {
      const png = file(name, 16);
      const want = toolbar16Pixels(ink);
      expect([png.width, png.height]).toEqual([16, 16]);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++)
          expect(png.pixel(x, y)).toEqual(want[y][x]);
    }
  );

  test.each(Object.keys(TOOLBAR_INK))(
    '%s 32 fills its box and keeps the disk: cut corner, solid shutter, open label',
    (name) => {
      const png = file(name, 32);
      expect([png.width, png.height]).toEqual([32, 32]);
      const alpha = (x, y) => png.pixel(x, y)[3];
      // Left, right, top and bottom edges all reach the box.
      expect(alpha(0, 16)).toBeGreaterThan(200);
      expect(alpha(31, 16)).toBeGreaterThan(200);
      expect(alpha(14, 0)).toBeGreaterThan(200);
      expect(alpha(16, 31)).toBeGreaterThan(200);
      // The cut corner, top right, is clear.
      expect(alpha(31, 0)).toBe(0);
      // Shutter solid, the wall beside it clear.
      expect(alpha(15, 6)).toBe(255);
      expect(alpha(6, 6)).toBe(0);
      // Label: a line, open inside.
      expect(alpha(16, 19)).toBe(255);
      expect(alpha(16, 25)).toBe(0);
    }
  );

  test.each(Object.entries(TOOLBAR_INK))(
    '%s 32 is one colour: only its edges fade',
    (name, ink) => {
      const png = file(name, 32);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const [pr, pg, pb, pa] = png.pixel(x, y);
          // Off by one at most: the browser rounds through premultiplied alpha.
          if (pa === 255) {
            expect(Math.abs(pr - r)).toBeLessThanOrEqual(1);
            expect(Math.abs(pg - g)).toBeLessThanOrEqual(1);
            expect(Math.abs(pb - b)).toBeLessThanOrEqual(1);
          }
        }
    }
  );

  test('the 16 grid keeps Chrome-like two pixel lines and the cut corner', () => {
    expect(TOOLBAR_16_GRID).toHaveLength(16);
    for (const row of TOOLBAR_16_GRID) expect(row).toHaveLength(16);
    expect(TOOLBAR_16_GRID[0].slice(13)).toBe('...');
    expect(TOOLBAR_16_GRID[8].startsWith('##.')).toBe(true);
    expect(TOOLBAR_16_GRID[8].endsWith('.##')).toBe(true);
  });
});
