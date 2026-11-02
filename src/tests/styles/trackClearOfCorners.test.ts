import { describe, expect, test } from 'vitest';

import { trackClearOfCorners } from '../../styles/corners';
import { RADIUS } from '../../styles/scale';

// KAN-888. A scrollbar's track stops short of the rounded corners its ends meet.
describe('trackClearOfCorners (KAN-888)', () => {
  test('one end: only that end of the track is held back, by the radius', () => {
    expect(trackClearOfCorners(RADIUS.PANEL, ['bottom'])).toBe(
      '&::-webkit-scrollbar-track { margin-bottom: 12px; }'
    );
  });

  test('both ends', () => {
    expect(trackClearOfCorners(RADIUS.DIALOG, ['top', 'bottom'])).toBe(
      '&::-webkit-scrollbar-track { margin-top: 16px; margin-bottom: 16px; }'
    );
  });
});
