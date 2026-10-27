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

  // Both the band and the sheet are centred, so in 9 of 13 languages the
  // longer label puts the button's middle left of the sheet's edge, and the
  // mocked curve's last stretch clipped the file's corner (ru: middle 1020).
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

  // Measured at a 20px root: the toolbar wraps and the middle lands at 1015;
  // swung out, the curve still stays off the file.
  test('draws for the wrapped toolbar of a 20px root', () => {
    const sheet = { right: 1048, top: 169 };
    const wrapped = { left: 955, width: 120, bottom: 128 };
    expect(savePdfPointerPaths(wrapped, sheet, 1280)).not.toBeNull();
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
