import { describe, expect, test } from 'vitest';

import { LIST_CARD_WIDTH, runStepPlan } from '../../components/tour/runSteps';
import { panelsBox, rowsBox } from '../../components/tour/anchorBox';
import { sameCorners } from '../../components/tour/coachMarkPlacement';
import { asRunStep, runStepKind } from '../../utils/functions/firstRun';
import { RADIUS } from '../../styles/scale';

// KAN-1023. The full view's drag card, after Windows: the session's windows
// ringed, Currently open lit beside them; the card over the saved list.
// Round 2: both live, to try a drag each way.
describe('the drag step', () => {
  test('rings the windows, lights Currently open’s panels, live, the card inside the saved list', () => {
    expect(runStepPlan('full', 'drag', null, 'S1', true, false)).toStrictEqual({
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
      isLive: true,
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

// KAN-1021. A pane's panels: its column's drawn children, together.
describe('panelsBox', () => {
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height }) as DOMRect;
  test('the panels in the column, not its padding; one not drawn is left out', () => {
    const pane = document.createElement('div');
    const column = document.createElement('div');
    const [header, list, hidden] = ['div', 'div', 'div'].map((tag) =>
      document.createElement(tag)
    );
    column.append(header, list, hidden);
    pane.append(column);
    document.body.append(pane);
    column.getBoundingClientRect = () => box(100, 0, 400, 800);
    header.getBoundingClientRect = () => box(104, 8, 390, 40);
    list.getBoundingClientRect = () => box(104, 56, 390, 734);
    hidden.getBoundingClientRect = () => box(0, 0, 0, 0);
    expect(panelsBox(pane)).toEqual({
      left: 104,
      top: 8,
      width: 390,
      height: 782,
    });
    pane.remove();
  });

  test('a column with nothing drawn: none', () => {
    const pane = document.createElement('div');
    pane.append(document.createElement('div'));
    document.body.append(pane);
    expect(panelsBox(pane)).toBeNull();
    pane.remove();
  });
});
