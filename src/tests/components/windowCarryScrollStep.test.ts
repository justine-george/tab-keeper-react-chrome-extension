import { describe, expect, it } from 'vitest';

import { windowCarryScrollStep } from '../../components/home/opennow/windowCarryScroll';
import { edgeScrollStep } from '../../components/home/rightpane/rowDrag/edgeScroll';

// KAN-895. A window carry's edge scroll over Currently open: the list from
// 100 to 700, x 0-400; the New window box pinned at its bottom, 650-700.
const LIST = { top: 100, bottom: 700, left: 0, right: 400 };
const PINNED = { top: 650, bottom: 700, left: 8, right: 392 };

describe('windowCarryScrollStep (KAN-895)', () => {
  it('scrolls down just above the pinned box, as the edge scroll with the box top as the bottom', () => {
    const step = windowCarryScrollStep(LIST, PINNED, 200, 640);
    expect(step).toBeGreaterThan(0);
    expect(step).toBe(
      edgeScrollStep({ top: 100, bottom: 650, height: 550 }, 640)
    );
  });

  it('does not scroll on the box itself', () => {
    expect(windowCarryScrollStep(LIST, PINNED, 200, 660)).toBe(0);
    expect(windowCarryScrollStep(LIST, PINNED, 200, 699)).toBe(0);
  });

  it('does not scroll in the middle of the list (control)', () => {
    expect(windowCarryScrollStep(LIST, PINNED, 200, 400)).toBe(0);
  });

  it('scrolls up near the list top', () => {
    expect(windowCarryScrollStep(LIST, PINNED, 200, 110)).toBeLessThan(0);
  });

  it('does not scroll outside the list: over the header above, or beside it', () => {
    expect(windowCarryScrollStep(LIST, PINNED, 200, 90)).toBe(0);
    expect(windowCarryScrollStep(LIST, PINNED, 450, 640)).toBe(0);
  });

  it('with no box in the list, the list bottom ends the zone', () => {
    expect(windowCarryScrollStep(LIST, null, 200, 690)).toBeGreaterThan(0);
    const below = { top: 720, bottom: 770, left: 8, right: 392 };
    expect(windowCarryScrollStep(LIST, below, 200, 690)).toBe(
      edgeScrollStep({ top: 100, bottom: 700, height: 600 }, 690)
    );
  });

  it('beside the box but in the list, still scrolls (the gutter is the list)', () => {
    expect(windowCarryScrollStep(LIST, PINNED, 4, 640)).toBeGreaterThan(0);
  });
});
