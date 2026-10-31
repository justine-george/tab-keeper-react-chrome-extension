import { describe, expect, test } from 'vitest';

import { savePdfPointerPaths } from '../../components/export/savePdfPointerPaths';

// Shaped like a 1280px window: the 816px sheet centred, Save as PDF… at the
// toolbar's right end.
const SHEET = { right: 1048, top: 140 };
const BUTTON = { left: 1000, width: 120, bottom: 100 };

const numbers = (path: string) =>
  (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('savePdfPointerPaths (KAN-826)', () => {
  test('starts on the ground right of the sheet and ends under the button', () => {
    const paths = savePdfPointerPaths(BUTTON, SHEET, 1280);

    expect(paths).not.toBeNull();
    // sheet.right + 18, sheet.top + 120
    expect(paths!.line.startsWith('M1066 260 ')).toBe(true);
    // The button's middle, 8px under it.
    expect(numbers(paths!.line).slice(-2)).toEqual([1060, 108]);
  });

  test('needs 90px between the sheet and the window edge', () => {
    expect(savePdfPointerPaths(BUTTON, SHEET, 1137)).toBeNull();
    // CONTROL: one more px of room draws it.
    expect(savePdfPointerPaths(BUTTON, SHEET, 1138)).not.toBeNull();
  });

  // KAN-826's 930px band ran past the sheet, so in 9 of 13 languages the
  // longer label put the button's middle left of the sheet's edge, and the
  // mocked curve's last stretch clipped the file's corner (ru: middle 1020).
  // Under KAN-880's header every middle is left of it.
  test("swings its approach out past the sheet's edge when the button is over it", () => {
    const ru = { left: 960, width: 120, bottom: 100 }; // middle 1020
    const paths = savePdfPointerPaths(ru, SHEET, 1280);

    expect(paths).not.toBeNull();
    // M x0 y0 C c1x c1y, c2x c2y, x1 y1
    const [, , , , c2x, , x1, y1] = numbers(paths!.line);
    expect(c2x).toBe(SHEET.right + 40);
    expect([x1, y1]).toEqual([1020, 108]);
  });

  // Measured in Russian at 1280: swung out, the mocked drop still clipped the
  // corner by 1px, so the approach rises the least that clears it (+45).
  test('rises just enough to clear the corner in Russian', () => {
    const sheet = { right: 1048, top: 149 };
    const ru = { left: 902.65625, width: 202.34375, bottom: 112 };
    const paths = savePdfPointerPaths(ru, sheet, 1280);

    expect(paths).not.toBeNull();
    const [, , , , c2x, c2y] = numbers(paths!.line);
    expect([c2x, c2y]).toEqual([1088, 120 + 45]);
  });

  // CONTROL: right of the edge, the curve is the mocked one.
  test('keeps the mocked approach when the button is right of the sheet', () => {
    const [, , , , c2x] = numbers(
      savePdfPointerPaths(BUTTON, SHEET, 1280)!.line
    );
    expect(c2x).toBe(1060 + 40);
  });

  // KAN-880. Measured at a 20px root at 1280: the toolbar holds one line, the
  // button grows to 179px and the sheet drops to 127; the tip steps right 3 times.
  test('draws at a 20px root', () => {
    const sheet = { right: 1048, top: 127 };
    const large = { left: 868.734375, width: 179.265625, bottom: 84.5 };
    const paths = savePdfPointerPaths(large, sheet, 1280);

    expect(paths).not.toBeNull();
    const [x1, y1] = numbers(paths!.line).slice(-2);
    expect(x1).toBeCloseTo(large.left + large.width / 2 + 12, 6);
    expect(y1).toBe(92.5);
  });

  // KAN-880. Measured at 1280 under the slim header: the button ends on the sheet's
  // edge, 36px above it, so no approach reaches its middle; the tip moves right the least that clears.
  test.each([
    ['en', { left: 897.4, width: 150.6, bottom: 82 }, 988.7],
    ['ru', { left: 846, width: 202, bottom: 82 }, 987],
  ])(
    'under the slim header (%s), the tip moves right of the middle just enough',
    (_, button, tipX) => {
      const sheet = { right: 1048, top: 118 };
      const paths = savePdfPointerPaths(button, sheet, 1280);

      expect(paths).not.toBeNull();
      const [x1, y1] = numbers(paths!.line).slice(-2);
      expect(x1).toBeCloseTo(tipX, 1);
      expect(y1).toBe(90);
      expect(x1).toBeLessThanOrEqual(button.left + button.width * 0.75);
    }
  );

  // KAN-880. Under the slim header at 1280 (button ending on the sheet's edge,
  // 36px above it) the last quarter reaches a clear tip for a button up to
  // 247px wide; Russian's, the widest, is 202. No width below that misses.
  test('under the slim header, draws for every button up to 247px wide, and none wider', () => {
    const sheet = { right: 1048, top: 118 };
    const button = (width: number) => ({
      left: sheet.right - width,
      width,
      bottom: 82,
    });
    const missed: number[] = [];
    for (let width = 100; width <= 247; width += 0.5) {
      if (!savePdfPointerPaths(button(width), sheet, 1280)) missed.push(width);
    }
    expect(missed).toEqual([]);
    expect(savePdfPointerPaths(button(248), sheet, 1280)).toBeNull();
  });

  // The backstop: a tip just over the sheet's top, far left, cannot be reached
  // from the ground without crossing the file.
  test('is withheld when even the swung curve would cross the sheet', () => {
    const sheet = { right: 1048, top: 169 };
    const farLeft = { left: 640, width: 120, bottom: 160 }; // tip 700, 168
    expect(savePdfPointerPaths(farLeft, sheet, 1280)).toBeNull();
  });

  test("the head's two arms each end 13px from the tip", () => {
    const head = numbers(savePdfPointerPaths(BUTTON, SHEET, 1280)!.head);
    const [ax, ay] = head.slice(0, 2);
    const [bx, by] = head.slice(-2);

    expect(Math.hypot(ax - 1060, ay - 108)).toBeCloseTo(13, 6);
    expect(Math.hypot(bx - 1060, by - 108)).toBeCloseTo(13, 6);
    // CONTROL: two arms, not one drawn twice.
    expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(5);
  });
});
