import { describe, expect, test } from 'vitest';

import { runStepPlan } from '../../components/tour/runSteps';
import type { RunStepKind } from '../../utils/functions/firstRun';

// KAN-901. The dim's hole takes the corners of what a step lights: the save
// row's field (8) and save group (12), the session list (12), the square
// Currently open pane. Every other step lights a CONTROL, the default.
describe('the corners each step lights', () => {
  const plan = (
    kind: RunStepKind,
    saveCard: 'save' | 'sessions' | null = null
  ) => runStepPlan('full', kind, saveCard, 'sample:x', true);

  test('the save row: 8 at the field’s corners on the left, 12 at the save group’s on the right', () => {
    expect(plan('save', 'save')?.holeCorners).toEqual([8, 12, 12, 8]);
  });
  test('the session list: 12 all round', () => {
    expect(plan('save', 'sessions')?.holeCorners).toEqual([12, 12, 12, 12]);
  });
  test('Currently open: square', () => {
    expect(plan('openNow')?.holeCorners).toEqual([0, 0, 0, 0]);
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
