import { describe, expect, test } from 'vitest';

import { CARD_WIDTH_PX, cardLeft } from '../../components/home/cardPlace';

// KAN-820 2B. The drag and carry card sits 8px right of the pointer, and flips
// to the left of it once the right of the card would pass the window's edge.

describe('cardLeft', () => {
  test('right of the pointer when it fits', () => {
    expect(cardLeft(100, 1024)).toBe(108);
  });

  test('fits exactly: still right', () => {
    expect(cardLeft(1024 - 8 - CARD_WIDTH_PX, 1024)).toBe(1024 - CARD_WIDTH_PX);
  });

  test('a pixel more: flips left of the pointer', () => {
    expect(cardLeft(1024 - 7 - CARD_WIDTH_PX, 1024)).toBe(
      1024 - 7 - CARD_WIDTH_PX - 8 - CARD_WIDTH_PX
    );
  });
});
