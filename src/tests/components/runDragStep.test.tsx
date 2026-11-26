import { describe, expect, test } from 'vitest';

import { LIST_CARD_WIDTH, runStepPlan } from '../../components/tour/runSteps';
import { panelsBox, rowsBox } from '../../components/tour/anchorBox';
import { sameCorners } from '../../components/tour/coachMarkPlacement';
import { asRunStep, runStepKind } from '../../utils/functions/firstRun';
import { RADIUS } from '../../styles/scale';

// KAN-1023. The full view's drag card, after Windows: the session's windows
// ringed, Currently open lit beside them, both look-only; the card over the
// saved list.
describe('the drag step', () => {
  test('rings the windows, lights Currently open’s panels, look-only, the card inside the saved list', () => {
    expect(runStepPlan('full', 'drag', null, 'S1', true, null)).toStrictEqual({
      anchors: ['[data-pane="detail"] [data-tour-anchor="windows"]'],
      boxOf: rowsBox,
      openings: [
        {
          selector: '[data-pane="open-now"]',
          boxOf: panelsBox,
          corners: sameCorners(Number.parseFloat(RADIUS.PANEL)),
        },
      ],
      sides: ['left', 'below', 'right'],
      within: '[data-pane="sessions"]',
      cardWidth: LIST_CARD_WIDTH,
      isLive: false,
    });
  });

  test('comes after Windows in the full view and is not in the popup', () => {
    expect(runStepKind('full', 8)).toBe('windows');
    expect(runStepKind('full', 9)).toBe('drag');
    expect(runStepKind('full', 10)).toBe('twoViews');
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
        runStepKind('popup', asRunStep('popup', s) ?? 0)
      )
    ).not.toContain('drag');
  });
});

// KAN-1021. A pane's panels: its column's content box, inside the padding.
describe('panelsBox', () => {
  test('the column inside its padding', () => {
    const pane = document.createElement('div');
    const column = document.createElement('div');
    column.style.padding = '8px 6px 10px 4px';
    pane.append(column);
    document.body.append(pane);
    column.getBoundingClientRect = () =>
      ({ left: 100, top: 0, width: 400, height: 800 }) as DOMRect;
    expect(panelsBox(pane)).toEqual({
      left: 104,
      top: 8,
      width: 390,
      height: 782,
    });
    pane.remove();
  });
});
