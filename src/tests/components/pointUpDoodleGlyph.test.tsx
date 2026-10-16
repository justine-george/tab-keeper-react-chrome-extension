import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';

import { PointUpDoodleGlyph } from '../../components/common/glyphs';
import { POINT_UP_DOODLE } from '../../components/common/pointUpDoodle';

// KAN-629. The pin guide's arrow reads as a marker line over the dimmed page, not a hairline.

// The guide draws it 50x84px (PinGuideModal); "meet" scales the viewBox by the tighter side.
const WIDTH = 50;
const HEIGHT = 84;

describe('the pin guide’s arrow (KAN-629)', () => {
  test('draws its line about 4px wide at the guide’s size', () => {
    const { container } = render(
      <PointUpDoodleGlyph width={`${WIDTH}px`} height={`${HEIGHT}px`} />
    );
    const svg = container.querySelector('svg');
    const scale = Math.min(
      WIDTH / POINT_UP_DOODLE.viewWidth,
      HEIGHT / POINT_UP_DOODLE.viewHeight
    );
    const drawn = Number(svg?.getAttribute('stroke-width')) * scale;
    expect(drawn).toBeGreaterThanOrEqual(4);
    expect(drawn).toBeLessThanOrEqual(4.5);
  });
});
