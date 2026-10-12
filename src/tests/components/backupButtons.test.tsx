import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

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

    // "Restore" is the session-opening verb: nothing on this pane uses it for
    // a file operation.
    expect(screen.queryByText(/^Restore /)).toBeNull();
  });

  test('the heading is Backup', async () => {
    await renderSyncAndBackup();
    expect(screen.getByText('Backup')).toBeTruthy();
  });
});
