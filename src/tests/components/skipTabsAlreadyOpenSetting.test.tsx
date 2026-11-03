import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-910. Settings › Sessions › Skip tabs already open: On or Off, right after Open saved windows.
const HELP =
  'Opening or dropping saved tabs into a window that’s already open leaves out pages it already has.';

const renderSessions = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SESSIONS));
    },
  });

describe('Settings › Sessions › Skip tabs already open', () => {
  it('sits directly after Open saved windows', async () => {
    const { container } = await renderSessions();
    const titles = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((s) => s.querySelector('span')?.textContent);
    const at = titles.indexOf('Open saved windows');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(titles[at + 1]).toBe('Skip tabs already open');
  });

  it('starts Off, is described by its help line, and On dispatches and shows On pressed', async () => {
    const user = userEvent.setup();
    const { store } = await renderSessions();
    const pair = screen.getByRole('group', { name: 'Skip tabs already open' });
    expect(within(pair).getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(pair).toHaveAccessibleDescription(HELP);
    expect(store.getState().settingsDataState.skipTabsAlreadyOpen).toBe(false);

    await user.click(within(pair).getByRole('button', { name: 'On' }));
    expect(store.getState().settingsDataState.skipTabsAlreadyOpen).toBe(true);
    expect(within(pair).getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(within(pair).getByRole('button', { name: 'Off' }));
    expect(store.getState().settingsDataState.skipTabsAlreadyOpen).toBe(false);
  });
});
