import { describe, expect, test } from 'vitest';
import { RADIUS } from '../../styles/scale';
import {
  ROW_GUTTER_PX,
  ROW_RADIUS,
  rowHighlightCss,
} from '../../styles/rowHighlight';

const px = (v: string) => Number.parseFloat(v);

// KAN-721: the nesting rules the approved C2 mocks were built on.
describe('the radius scale nests (KAN-721)', () => {
  test('a child flush in a panel corner sits inside its 1px border', () => {
    expect(px(RADIUS.PANEL_INNER)).toBe(px(RADIUS.PANEL) - 1);
  });
  test("a menu item is a PANEL-radius menu less the menu's 4px padding", () => {
    expect(px(RADIUS.CONTROL)).toBe(px(RADIUS.PANEL) - 4);
  });
  test("the SlidingPair knob is the track less the track's 2px padding", () => {
    expect(px(RADIUS.KNOB)).toBe(px(RADIUS.CONTROL) - 2);
  });
  test('the tour ring sits 4px outside a control', () => {
    expect(px(RADIUS.PANEL)).toBe(px(RADIUS.CONTROL) + 4);
  });
  test('a row highlight is a panel less the row gutter', () => {
    expect(px(ROW_RADIUS)).toBe(px(RADIUS.PANEL) - ROW_GUTTER_PX);
  });
});

describe('rowHighlightCss (KAN-721)', () => {
  const css = rowHighlightCss();
  test('the fill stops at the padding box, 4px in from each side', () => {
    expect(css).toContain('background-clip: padding-box');
    expect(css).toContain(`border-left: ${ROW_GUTTER_PX}px solid transparent`);
    expect(css).toContain(`border-right: ${ROW_GUTTER_PX}px solid transparent`);
  });
  test('the padding-box curve is ROW_RADIUS square: the horizontal radius carries the gutter', () => {
    expect(css).toContain('border-radius: 12px / 8px');
  });
  test('it is a squircle', () => {
    expect(css).toContain('corner-shape: squircle');
  });
});
