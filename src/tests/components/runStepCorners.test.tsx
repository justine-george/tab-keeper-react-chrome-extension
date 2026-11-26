import { describe, expect, test } from 'vitest';

import { runStepPlan } from '../../components/tour/runSteps';
import { panelsBox } from '../../components/tour/anchorBox';
import type { RunStepKind } from '../../utils/functions/firstRun';

// KAN-901. The dim's hole takes the corners of what a step lights: the save
// row's field (8) and save group (12), the session list (12), Currently
// open's panels (12, O1). Every other step lights a CONTROL, the default.
describe('the corners each step lights', () => {
  const plan = (
    kind: RunStepKind,
    saveCard: 'save' | 'sessions' | null = null
  ) => runStepPlan('full', kind, saveCard, 'sample:x', true, null);

  test('the save row: 8 at the field’s corners on the left, 12 at the save group’s on the right', () => {
    expect(plan('save', 'save')?.holeCorners).toEqual([8, 12, 12, 8]);
  });
  test('the session list: 12 all round', () => {
    expect(plan('save', 'sessions')?.holeCorners).toEqual([12, 12, 12, 12]);
  });
  test('Currently open: its panels, not the column, 12 all round', () => {
    expect(plan('openNow')?.boxOf).toBe(panelsBox);
    expect(plan('openNow')?.holeCorners).toEqual([12, 12, 12, 12]);
  });
  test('on the rail, step 2 lights the rail’s card as step 1 does, 12 all round', () => {
    const rail = runStepPlan(
      'full',
      'findAndFit',
      null,
      'sample:x',
      true,
      null,
      true
    );
    expect(rail?.anchors).toEqual(['[data-pane="open-now"]']);
    expect(rail?.boxOf).toBe(panelsBox);
    expect(rail?.holeCorners).toEqual([12, 12, 12, 12]);
  });
  test('the edge beside the search row: lit, too thin to ring', () => {
    expect(plan('findAndFit')?.openings?.[0]).toEqual({
      selector: '[data-resize-grip]',
      isRinged: false,
    });
  });
  test('a row, a button or a run of rows: none given, so a CONTROL’s', () => {
    for (const kind of [
      'row',
      'open',
      'replace',
      'delete',
      'windows',
      'fullView',
      'compactView',
      'findAndFit',
    ] as const)
      expect(plan(kind)?.holeCorners, kind).toBeUndefined();
  });
});
