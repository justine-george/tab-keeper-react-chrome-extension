import { describe, expect, test } from 'vitest';

import { doodleTipFromLeft } from '../../components/common/pointUpDoodle';

// KAN-411. Where the pin guide's arrow tip lands in its drawn box.
describe('doodleTipFromLeft', () => {
  test('a box narrower than the viewBox ratio fits by width: tip at x * scale', () => {
    expect(doodleTipFromLeft(50, 84)).toBeCloseTo((31 * 50) / 60, 6);
  });

  test('a wider box fits by height and centres the drawing', () => {
    // scale 0.5, so the 30px-wide drawing sits 15px in; the tip 15.5px further.
    expect(doodleTipFromLeft(60, 50)).toBeCloseTo(30.5, 6);
  });
});
