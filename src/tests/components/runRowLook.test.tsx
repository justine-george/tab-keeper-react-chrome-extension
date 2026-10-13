import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { classRulesFor } from '../setup/hoverRules';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { runShownHere } from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { newRun, type RunStep } from '../../utils/functions/firstRun';

// Spec delta 2: the run's row is drawn engaged at its row steps. KAN-582: Delete left the row, so the Delete step (5) points at the header's ⋮ instead.

const RUN = buildSession({
  tabGroupId: 'run',
  title: 'Lisbon trip',
  isSelected: true,
});
const OTHER = buildSession({ tabGroupId: 'other', title: 'Other' });

const atStep =
  (step: RunStep) => (store: RenderWithProvidersResult['store']) => {
    store.dispatch(replaceState(buildContainer([RUN, OTHER])));
    store.dispatch(selectTabContainer('run'));
    store.dispatch(
      recordFirstRun({ ...newRun('popup', step), sessionId: 'run' })
    );
    store.dispatch(runShownHere());
  };

async function renderRow(session: typeof RUN, step: RunStep) {
  const onOpen = vi.fn();
  const onFocus = vi.fn();
  const r = await renderWithProviders(
    <TabGroupEntry
      tabGroupData={session}
      onTabGroupClick={() => undefined}
      onOpenAllClick={onOpen}
      onFocusClick={onFocus}
      onReplaceClick={() => undefined}
    />,
    { seedStore: atStep(step) }
  );
  return { ...r, onOpen, onFocus };
}
const rowOf = (container: HTMLElement) => container.firstElementChild;

describe('the run’s row', () => {
  test.each([2, 3, 4] as const)(
    'step %s: the run’s row is engaged, by its own rule',
    async (step) => {
      const { container } = await renderRow(RUN, step);
      const row = rowOf(container);
      expect(row).toHaveAttribute('data-run-engaged');
      expect(classRulesFor(row ?? document.body)).toMatch(
        /\[data-run-engaged\][^{]*\{[^}]*/
      );
    }
  );

  test('another row is not engaged; nor is the run’s at a step that does not point at it', async () => {
    expect(rowOf((await renderRow(OTHER, 2)).container)).not.toHaveAttribute(
      'data-run-engaged'
    );
    for (const step of [5, 6] as const)
      expect(rowOf((await renderRow(RUN, step)).container)).not.toHaveAttribute(
        'data-run-engaged'
      );
  });
});

const DIM = /filter:\s*opacity\(0\.3\)/;

describe('the lit Open and Switch (M3 B)', () => {
  test('Open step: Open is full strength and still blocked; Switch keeps the dim', async () => {
    const { onOpen, onFocus } = await renderRow(RUN, 3);
    const open = screen.getByRole('button', { name: 'Open' });
    expect(open).toHaveAttribute('aria-disabled', 'true');
    expect(classRulesFor(open)).not.toMatch(DIM);
    expect(
      classRulesFor(screen.getByRole('button', { name: 'Switch' }))
    ).toMatch(DIM);
    fireEvent.click(open);
    fireEvent.keyDown(open, { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onFocus).not.toHaveBeenCalled();
  });

  test('Switch step: Switch is full strength and still blocked; Open keeps the dim', async () => {
    const { onOpen, onFocus } = await renderRow(RUN, 4);
    const sw = screen.getByRole('button', { name: 'Switch' });
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    expect(classRulesFor(sw)).not.toMatch(DIM);
    expect(classRulesFor(screen.getByRole('button', { name: 'Open' }))).toMatch(
      DIM
    );
    fireEvent.click(sw);
    fireEvent.keyDown(sw, { key: 'Enter' });
    expect(onFocus).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('the row step lights neither: both keep the dim', async () => {
    await renderRow(RUN, 2);
    for (const name of ['Open', 'Switch']) {
      expect(classRulesFor(screen.getByRole('button', { name }))).toMatch(DIM);
    }
  });
});
