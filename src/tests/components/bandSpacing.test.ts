import { describe, expect, it } from 'vitest';

import {
  ADJACENT_GROUP_GAP_PX,
  BAND_MARGIN_PX,
  marginHoldingGap,
} from '../../components/home/rightpane/bandSpacing';

// CSS 2.2 §8.3.1, for two adjoining vertical margins where `b` is never
// negative: both positive collapse to the larger, a negative one is added.
const collapse = (a: number, b: number) => (a >= 0 ? Math.max(a, b) : a + b);

// KAN-612. A band grows by `padding` on one side and gives that much back in
// margin, which must leave the gap to its neighbour where it rested.
describe('marginHoldingGap', () => {
  const cases = [
    // [own resting margin, neighbour's margin, padding]
    ['bottom, a loose row below', BAND_MARGIN_PX, 0, 32],
    ['bottom, a band below', BAND_MARGIN_PX, ADJACENT_GROUP_GAP_PX, 32],
    ['top, a loose row above', BAND_MARGIN_PX, 0, 32],
    ['top, a band above', ADJACENT_GROUP_GAP_PX, BAND_MARGIN_PX, 32],
    ['small growth, a band above', ADJACENT_GROUP_GAP_PX, BAND_MARGIN_PX, 4],
    ['small growth, a band below', BAND_MARGIN_PX, ADJACENT_GROUP_GAP_PX, 2],
    ['no growth, a band above', ADJACENT_GROUP_GAP_PX, BAND_MARGIN_PX, 0],
  ] as const;

  it.each(cases)('%s: the gap stays', (_, own, neighbour, padding) => {
    const margin = marginHoldingGap(own, neighbour, padding);
    expect(collapse(margin, neighbour) + padding).toBe(
      collapse(own, neighbour)
    );
  });

  it('between two bands it borrows the shared gap, not only its own margin', () => {
    // The pre-KAN-612 arithmetic, own - padding, left the pair 10px apart.
    expect(marginHoldingGap(BAND_MARGIN_PX, ADJACENT_GROUP_GAP_PX, 32)).toBe(
      -32
    );
    expect(marginHoldingGap(ADJACENT_GROUP_GAP_PX, BAND_MARGIN_PX, 32)).toBe(
      -26
    );
    expect(marginHoldingGap(BAND_MARGIN_PX, 0, 32)).toBe(-30);
  });
});
