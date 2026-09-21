import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-251. "Backup App Data to File" / "Restore App Data from File" misled
// three ways. "Restore" is the app's verb for opening a saved session; here
// it replaced every session with the file's. The icons pointed the wrong
// way: `publish` (up) on the button that downloads, `get_app` (down) on the
// one that opens a file picker. And "App Data" is sessions only -- no
// settings travel in the file.
//
// The icon is asserted through its ligature text, which is what the bundled
// subset draws: a name that is not in iconNames.ts fails tsc, and one that is
// but was not fetched fails e2e/icon-font-subset.spec.ts.

const renderSyncAndBackup = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SYNC));
    },
  });

const glyphOf = (button: HTMLElement) =>
  button.querySelector('.material-symbols-outlined')?.textContent?.trim();

describe('the backup buttons say what they do (KAN-251)', () => {
  // KAN-261 renamed the second button from "Replace sessions from a backup":
  // once it can merge, "Replace" was the lie. "Load" names the file step; the
  // dialog that follows names the two things it can do with it.
  test('save is a download, load is an upload, and both name sessions', async () => {
    await renderSyncAndBackup();

    const save = screen.getByRole('button', {
      name: 'Save sessions to a file',
    });
    const load = screen.getByRole('button', {
      name: 'Load sessions from a backup',
    });
    expect(glyphOf(save)).toBe('download');
    expect(glyphOf(load)).toBe('upload');

    // The old words are gone, and "Restore" with them: nothing on this pane
    // uses the session-opening verb for a file operation.
    expect(screen.queryByText(/App Data/)).toBeNull();
    expect(screen.queryByText(/^Restore /)).toBeNull();
  });

  test('the heading is Backup, and nothing under the buttons restates them', async () => {
    await renderSyncAndBackup();
    expect(screen.getByText('Backup')).toBeTruthy();
    expect(screen.queryByText('Backup & Restore')).toBeNull();
    // Both labels already say "sessions"; a note saying so again was cut.
    expect(screen.queryByText(/not your settings/)).toBeNull();
  });

  test('CONTROL: the glyph reader sees a real icon', async () => {
    await renderSyncAndBackup();
    // The pair's buttons carry no icon, so the reader must return undefined
    // there and a name on the backup buttons -- not the same value for both.
    const pair = screen.getByRole('group', { name: 'Auto Sync' });
    expect(
      glyphOf(within(pair).getByRole('button', { name: 'On' }))
    ).toBeUndefined();
  });
});
