import { describe, expect, test } from 'vitest';

import { runStepPlan } from '../../components/tour/runSteps';
import { visibleRowFill } from '../../components/tour/anchorBox';
import { sameCorners } from '../../components/tour/coachMarkPlacement';
import { RADIUS } from '../../styles/scale';

// KAN-999. Folded with the Saved session card drawn, step 2 lights the card
// and the selected session's row, each pressable in a hole of its own, and
// sits below the search row so it covers neither.
const plan = (foldedSessionId: string | null) =>
  runStepPlan('full', 'findAndFit', null, null, true, foldedSessionId);

describe('step 2, folded behind the Saved session card', () => {
  test('lights the grip, the card in its own corners, and the selected row; sits below', () => {
    const p = plan('S1');
    expect(p?.openings?.map((o) => o.selector)).toEqual([
      '[data-resize-grip]',
      '[data-saved-session-card]',
      '[data-pane="sessions"] [data-drag-row-id="S1"]',
    ]);
    expect(p?.openings?.[1].corners).toEqual(
      sameCorners(Number.parseFloat(RADIUS.PANEL))
    );
    expect(p?.openings?.[2].boxOf).toBe(visibleRowFill);
    expect(p?.sides).toEqual(['below', 'right', 'left']);
  });

  test('no card (nothing saved, or not folded): the grip only, left of the search row, as before', () => {
    const p = plan(null);
    expect(p?.openings?.map((o) => o.selector)).toEqual(['[data-resize-grip]']);
    expect(p?.sides).toEqual(['left', 'below', 'right']);
  });
});

// The row's fill, clipped to what its list shows: a row scrolled out of
// view lights nothing outside the list.
describe('visibleRowFill', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  const mount = (rowTop: number) => {
    const scroller = document.createElement('div');
    scroller.style.overflow = 'auto';
    const row = document.createElement('div');
    const fill = document.createElement('div');
    fill.setAttribute('data-drag-handle-row', '');
    row.append(fill);
    scroller.append(row);
    document.body.append(scroller);
    scroller.getBoundingClientRect = () => rect(0, 100, 300, 200);
    Object.defineProperties(scroller, {
      clientWidth: { value: 300 },
      clientHeight: { value: 200 },
    });
    fill.getBoundingClientRect = () => rect(4, rowTop, 292, 32);
    Object.defineProperties(fill, {
      clientWidth: { value: 292 },
      clientHeight: { value: 32 },
    });
    return row;
  };

  test('a row in view: its whole fill', () => {
    expect(visibleRowFill(mount(150))).toEqual({
      left: 4,
      top: 150,
      width: 292,
      height: 32,
    });
  });

  test('a row half under the list top: the part shown', () => {
    expect(visibleRowFill(mount(84))).toEqual({
      left: 4,
      top: 100,
      width: 292,
      height: 16,
    });
  });

  test('a row scrolled out of view: nothing', () => {
    expect(visibleRowFill(mount(20))).toBeNull();
  });
});
