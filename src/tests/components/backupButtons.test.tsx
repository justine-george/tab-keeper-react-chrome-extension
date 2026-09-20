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

const renderDataManagement = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.DATA_MANAGEMENT));
    },
  });

const glyphOf = (button: HTMLElement) =>
  button.querySelector('.material-symbols-outlined')?.textContent?.trim();

describe('the backup buttons say what they do (KAN-251)', () => {
  test('save is a download, replace is an upload, and both name sessions', async () => {
    await renderDataManagement();

    const save = screen.getByRole('button', {
      name: 'Save sessions to a file',
    });
    const replace = screen.getByRole('button', {
      name: 'Replace sessions from a backup',
    });
    expect(glyphOf(save)).toBe('download');
    expect(glyphOf(replace)).toBe('upload');

    // The old words are gone, and "Restore" with them: nothing on this pane
    // uses the session-opening verb for a file operation.
    expect(screen.queryByText(/App Data/)).toBeNull();
    expect(screen.queryByText(/^Restore /)).toBeNull();
  });

  test('the heading is Backup, and the line under it says what a backup holds', async () => {
    await renderDataManagement();
    expect(screen.getByText('Backup')).toBeTruthy();
    expect(screen.queryByText('Backup & Restore')).toBeNull();
    expect(
      screen.getByText('A backup holds your sessions, not your settings.')
    ).toBeTruthy();
  });

  test('CONTROL: the glyph reader sees a real icon', async () => {
    await renderDataManagement();
    // The pair's buttons carry no icon, so the reader must return undefined
    // there and a name on the backup buttons -- not the same value for both.
    const pair = screen.getByRole('group', { name: 'Save Tab Groups' });
    expect(
      glyphOf(within(pair).getByRole('button', { name: 'On' }))
    ).toBeUndefined();
  });
});
