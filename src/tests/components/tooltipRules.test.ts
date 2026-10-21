import { describe, expect, test } from 'vitest';
import {
  FIRST_DELAY_MS,
  GAP_PX,
  INSET_PX,
  MAX_WIDTH_PX,
  WARM_DELAY_MS,
  WARM_WINDOW_MS,
  placeTooltip,
  showDelay,
  tooltipDescription,
} from '../../components/common/tooltipRules';

const VIEWPORT = { width: 800, height: 600 };
const TIP = { width: 80, height: 24 };
const anchorAt = (left: number, top: number) => ({
  left,
  top,
  width: 40,
  height: 20,
});

describe('tooltip constants', () => {
  test('are the designed values', () => {
    expect([
      FIRST_DELAY_MS,
      WARM_DELAY_MS,
      WARM_WINDOW_MS,
      GAP_PX,
      INSET_PX,
      MAX_WIDTH_PX,
    ]).toEqual([300, 100, 500, 6, 8, 260]);
  });
});

describe('showDelay', () => {
  test('is the first delay when nothing was shown yet', () => {
    expect(showDelay(1000, null)).toBe(300);
  });

  test('is the warm delay within the warm window', () => {
    expect(showDelay(1000, 600)).toBe(100);
    expect(showDelay(1000, 501)).toBe(100);
  });

  test('exactly the window ago is cold', () => {
    expect(showDelay(1000, 500)).toBe(300);
  });

  test('long ago is cold', () => {
    expect(showDelay(1000, 0)).toBe(300);
  });
});

describe('placeTooltip', () => {
  test('goes below, centred on the anchor', () => {
    expect(placeTooltip(anchorAt(100, 100), TIP, VIEWPORT)).toEqual({
      left: 80,
      top: 126,
      side: 'below',
    });
  });

  test('goes above when below does not fit', () => {
    expect(placeTooltip(anchorAt(100, 570), TIP, VIEWPORT)).toEqual({
      left: 80,
      top: 570 - 6 - 24,
      side: 'above',
    });
  });

  test('below still fits flush against the inset, above does not', () => {
    // 100+20+6+24 = 150 <= 600-8 : pick the largest top that still fits
    const top = 600 - 8 - 24 - 6 - 20;
    expect(placeTooltip(anchorAt(100, top), TIP, VIEWPORT).side).toBe('below');
    expect(placeTooltip(anchorAt(100, top + 1), TIP, VIEWPORT).side).toBe(
      'above'
    );
  });

  test('stays inside the left inset', () => {
    expect(placeTooltip(anchorAt(0, 100), TIP, VIEWPORT).left).toBe(8);
  });

  test('stays inside the right inset', () => {
    expect(placeTooltip(anchorAt(780, 100), TIP, VIEWPORT).left).toBe(
      800 - 8 - 80
    );
  });

  test('fitting neither side goes below, clamped into the viewport', () => {
    const tall = { width: 80, height: 400 };
    expect(placeTooltip(anchorAt(100, 250), tall, VIEWPORT)).toEqual({
      left: 80,
      top: 600 - 8 - 400,
      side: 'below',
    });
  });
});

describe('tooltipDescription', () => {
  test('is undefined when the tooltip repeats the name', () => {
    expect(tooltipDescription('Sync now', 'Sync now')).toBeUndefined();
    expect(tooltipDescription('Delete', 'Delete session Work')).toBeUndefined();
  });

  test('keeps a tooltip that says more than the name', () => {
    expect(
      tooltipDescription('Replace this session with open windows', 'Replace')
    ).toBe('Replace this session with open windows');
  });

  test('is undefined without a tooltip, or an empty one', () => {
    expect(tooltipDescription(undefined, 'x')).toBeUndefined();
    expect(tooltipDescription('', 'x')).toBeUndefined();
    expect(tooltipDescription('', undefined)).toBeUndefined();
  });

  test('keeps the tooltip when there is no name', () => {
    expect(tooltipDescription('x', undefined)).toBe('x');
  });
});
