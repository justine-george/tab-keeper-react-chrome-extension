import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { runStepPlan } from '../../components/tour/runSteps';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
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

// KAN-582. Delete lives only in the session header's ⋮, so the run's Delete step points there, and (hard rule 2) the ⋮ explains only while it does.

const RUN = buildSession({ tabGroupId: 'run', title: 'Lisbon trip' });

afterEach(() => history.replaceState(null, '', '/'));

const DELETE_STEP: RunStep = 6;

async function renderHeader(step: RunStep) {
  return renderWithProviders(<HeroContainerRight />, {
    seed: { windows: [{ id: 1 }] },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([RUN])));
      store.dispatch(selectTabContainer('run'));
      store.dispatch(
        recordFirstRun({ ...newRun('popup', step), sessionId: 'run' })
      );
      store.dispatch(runShownHere());
    },
  });
}
const more = () => screen.getByRole('button', { name: 'More actions' });

describe('the run’s Delete step (KAN-582)', () => {
  test('step 6 is the Delete step in the popup', () => {
    expect(runStepKind('popup', DELETE_STEP)).toBe('delete');
  });

  test('it points at the session header’s ⋮, in both views', () => {
    for (const view of ['popup', 'full'] as const)
      expect(runStepPlan(view, 'delete', null, 'run')?.anchors).toEqual([
        '[data-pane="detail"] [data-tour-anchor="session-menu"]',
      ]);
  });

  test('while it shows, the ⋮ is held: it opens no menu', async () => {
    await renderHeader(DELETE_STEP);

    expect(more()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(more());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('CONTROL: at another step the ⋮ opens its menu, Delete included', async () => {
    await renderHeader(4);

    expect(more()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(more());
    expect(
      screen.getByRole('menuitem', { name: 'Delete session' })
    ).toBeInTheDocument();
  });
});
