import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import { runStepPlan } from '../../components/tour/runSteps';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { classRulesFor } from '../setup/hoverRules';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { runShownHere } from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  newRun,
  runStepKind,
  type RunStep,
} from '../../utils/functions/firstRun';

// KAN-586. The run explains the row's Replace in its own step, after Switch
// (popup) or Open (full view): the row is engaged, and its Replace is lit but
// waits for the tour, as Open and Switch do at theirs (KAN-413).

const SAMPLE = 'sample:x';
const REPLACE_STEP: RunStep = 5;
const SWITCH_STEP: RunStep = 4;

async function renderRowAt(step: RunStep) {
  const session = buildSession({ tabGroupId: SAMPLE, isSelected: true });
  return renderWithProviders(
    <TabGroupEntry
      tabGroupData={session}
      onTabGroupClick={() => undefined}
      onOpenAllClick={() => undefined}
      onFocusClick={() => undefined}
      onReplaceClick={() => undefined}
      onDeleteKey={() => undefined}
      deleteKeyShortcuts="Delete Backspace"
    />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([session])));
        store.dispatch(selectTabContainer(SAMPLE));
        store.dispatch(
          recordFirstRun({ ...newRun('popup', step), sessionId: SAMPLE })
        );
        store.dispatch(runShownHere());
      },
    }
  );
}
const dimmed = (name: string) =>
  /filter:\s*opacity\(0\.3\)/.test(
    classRulesFor(screen.getByRole('button', { name }))
  );

describe('the run’s Replace step (KAN-586)', () => {
  test('after Switch in the popup, after Open in the full view, before Delete', () => {
    expect(runStepKind('popup', 4)).toBe('switch');
    expect(runStepKind('popup', REPLACE_STEP)).toBe('replace');
    expect(runStepKind('full', 5)).toBe('open');
    expect(runStepKind('full', 6)).toBe('replace');
    expect(runStepKind('popup', 6)).toBe('delete');
    expect(runStepKind('full', 7)).toBe('delete');
  });

  test('it points at the engaged row’s Replace, below it, in both views', () => {
    for (const view of ['popup', 'full'] as const)
      expect(runStepPlan(view, 'replace', null, SAMPLE, false)).toEqual({
        anchors: [
          '[data-pane="sessions"] [data-drag-row-id="sample\\:x"] [data-run-engaged] [data-tour-anchor="row-replace"]',
        ],
        sides: ['below', 'right', 'left'],
        isLive: false,
      });
    // No session yet: no card, as at Open and Switch.
    expect(runStepPlan('popup', 'replace', null, null, false)).toBeNull();
  });

  test('at its step the row’s Replace is lit, still waiting; Open and Switch are dimmed', async () => {
    await renderRowAt(REPLACE_STEP);

    const replace = screen.getByRole('button', { name: 'Replace' });
    expect(replace.closest('[data-run-engaged]')).not.toBeNull();
    expect(replace).toHaveAttribute('data-tour-anchor', 'row-replace');
    expect(replace).toHaveAttribute('aria-disabled', 'true');
    expect(dimmed('Replace')).toBe(false);
    expect(dimmed('Open')).toBe(true);
    expect(dimmed('Switch')).toBe(true);
  });

  test('CONTROL: at the Switch step, Switch is lit and Replace dimmed', async () => {
    await renderRowAt(SWITCH_STEP);

    expect(dimmed('Switch')).toBe(false);
    expect(dimmed('Replace')).toBe(true);
  });
});
