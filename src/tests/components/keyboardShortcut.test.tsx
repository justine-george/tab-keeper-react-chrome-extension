import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-256. The popup gained a keyboard shortcut (manifest `_execute_action`)
// and the Sessions pane a row that shows the binding Chrome actually
// assigned -- never the manifest's suggestion, which Chrome honours only if
// the key is free -- with a button to the one place a user can change it.

const renderSessions = (commands?: chrome.commands.Command[]) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed: { commands },
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SESSIONS));
    },
  });

describe('the Sessions pane shows the popup shortcut (KAN-256)', () => {
  test('shows the binding Chrome reports', async () => {
    await renderSessions([
      { name: '_execute_action', shortcut: 'Alt+Shift+K' },
    ]);
    expect(screen.getByText('Keyboard shortcut')).toBeTruthy();
    expect(await screen.findByText('Alt+Shift+K')).toBeTruthy();
  });

  test('says Not set when Chrome assigned nothing', async () => {
    await renderSessions([{ name: '_execute_action', shortcut: '' }]);
    expect(await screen.findByText('Not set')).toBeTruthy();
  });

  test('Change opens the Chrome shortcuts page in a tab', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderSessions([
      { name: '_execute_action', shortcut: 'Alt+Shift+K' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Change shortcut' }));
    expect(chrome.createdTabs).toEqual([
      { url: 'chrome://extensions/shortcuts' },
    ]);
  });
});
