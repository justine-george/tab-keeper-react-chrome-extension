import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsCategoryContainer from '../../components/settings/leftpane/SettingsCategoryContainer';
import { SetupModal } from '../../components/modals/SetupModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { classRulesFor } from '../setup/hoverRules';
import { openSetup } from '../../redux/slices/globalStateSlice';

// KAN-888. Boxes that scroll only at a large browser font or in a short window,
// so e2e/scrollbar-corners.spec.ts cannot reach them naturally: their bar's
// track stops short of both of their own rounded corners.
const trackRule = (el: Element) =>
  classRulesFor(el)
    .split('\n')
    .find((rule) => rule.includes('::-webkit-scrollbar-track')) ?? '';

describe('the bar stays clear of rounded corners (KAN-888)', () => {
  test('the Settings category list: 12px at top and bottom', async () => {
    await renderWithProviders(<SettingsCategoryContainer />);
    let list: HTMLElement | null = screen.getByText('Display');
    while (list && getComputedStyle(list).overflow !== 'auto')
      list = list.parentElement;
    if (list === null) throw new Error('no scrolling list');
    expect(trackRule(list)).toMatch(/margin-top: 12px;\s*margin-bottom: 12px/);
  });

  test('the setup dialog: 16px at top and bottom', async () => {
    await renderWithProviders(<SetupModal />, {
      seedStore: (store) => store.dispatch(openSetup()),
    });
    const dialog = screen.getByRole('dialog');
    expect(trackRule(dialog)).toMatch(
      /margin-top: 16px;\s*margin-bottom: 16px/
    );
  });
});
