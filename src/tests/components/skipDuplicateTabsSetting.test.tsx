import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-906. Settings › Sessions › Skip duplicates when saving: On or Off, right after Save tab groups.
const HELP =
  'When you add or move a window or tabs to a saved session, pages it already has are left out, and a new session keeps one copy of each.';

const renderSessions = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SESSIONS));
    },
  });

describe('Settings › Sessions › Skip duplicates when saving', () => {
  it('starts Off, is described by its help line, and On dispatches and shows On pressed', async () => {
    const user = userEvent.setup();
    const { store } = await renderSessions();
    const pair = screen.getByRole('group', {
      name: 'Skip duplicates when saving',
    });
    expect(within(pair).getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(pair).toHaveAccessibleDescription(HELP);
    expect(store.getState().settingsDataState.skipDuplicateTabs).toBe(false);

    await user.click(within(pair).getByRole('button', { name: 'On' }));
    expect(store.getState().settingsDataState.skipDuplicateTabs).toBe(true);
    expect(within(pair).getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(pair).getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    await user.click(within(pair).getByRole('button', { name: 'Off' }));
    expect(store.getState().settingsDataState.skipDuplicateTabs).toBe(false);
  });
});
