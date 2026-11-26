import { describe, expect, test } from 'vitest';

import { runStepPlan } from '../../components/tour/runSteps';

// Round 3 (A). Folded behind the Saved session card, step 2 teaches search
// alone: it lights the grip only, and sits below the search row, clear of the card.
const plan = (hasSavedCard: boolean) =>
  runStepPlan('full', 'findAndFit', null, null, true, hasSavedCard);

describe('step 2, folded behind the Saved session card', () => {
  test('lights the grip only, not the card or a row; sits below', () => {
    const p = plan(true);
    expect(p?.openings?.map((o) => o.selector)).toEqual(['[data-resize-grip]']);
    expect(p?.sides).toEqual(['below', 'right', 'left']);
  });

  test('no card (nothing saved, or not folded): the grip only, left of the search row', () => {
    const p = plan(false);
    expect(p?.openings?.map((o) => o.selector)).toEqual(['[data-resize-grip]']);
    expect(p?.sides).toEqual(['left', 'below', 'right']);
  });

  // KAN-1020. Typing lists matches from the left under the search row, so
  // below it the card hangs from the row's right end, folded or not.
  test.each([[true], [false]])(
    'below the search row, the card hangs from its end (card drawn: %s)',
    (hasSavedCard) => {
      expect(plan(hasSavedCard)?.belowAt).toBe('end');
    }
  );
});
