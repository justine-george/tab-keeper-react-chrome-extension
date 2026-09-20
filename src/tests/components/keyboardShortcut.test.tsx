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
  test('a sentence that says what the key does, with one keycap per key', async () => {
    await renderSessions([
      { name: '_execute_action', shortcut: 'Alt+Shift+K' },
    ]);
    expect(screen.getByText('Keyboard shortcut')).toBeTruthy();
    const sentence = await screen.findByTestId('popup-shortcut');
    expect(sentence.textContent).toMatch(/^Press /);
    expect(sentence.textContent).toMatch(/to open Tab Keeper\.$/);
    const caps = [...sentence.querySelectorAll('kbd')].map(
      (k) => k.textContent
    );
    expect(caps).toEqual(['Alt', 'Shift', 'K']);
  });

  test('the Mac form gets one cap per glyph', async () => {
    await renderSessions([{ name: '_execute_action', shortcut: '⌥⇧K' }]);
    const sentence = await screen.findByTestId('popup-shortcut');
    const caps = [...sentence.querySelectorAll('kbd')].map(
      (k) => k.textContent
    );
    expect(caps).toEqual(['⌥', '⇧', 'K']);
  });

  test('says so when Chrome assigned nothing, with no empty caps', async () => {
    await renderSessions([{ name: '_execute_action', shortcut: '' }]);
    const sentence = await screen.findByTestId('popup-shortcut');
    expect(sentence.textContent).toBe('No shortcut is set to open Tab Keeper.');
    expect(sentence.querySelectorAll('kbd')).toHaveLength(0);
  });

  test('Change opens the Chrome shortcuts page in a tab', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderSessions([
      { name: '_execute_action', shortcut: 'Alt+Shift+K' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(chrome.createdTabs).toEqual([
      { url: 'chrome://extensions/shortcuts' },
    ]);
  });
});
