import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  initialState,
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import en from '../../../public/locales/en/translation.json';

// KAN-253. Two of the five categories did not name their contents: "Sync &
// Privacy" held no privacy setting, and "Data Management" was a bucket for
// one capture setting and two file actions. Now "Sessions" holds what a save
// captures (Save Tab Groups), and "Sync & Backup" holds where the data lives
// and how to get it back (Auto Sync, status, Backup).

const renderOn = (category: SettingsCategory) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(category));
    },
  });

describe('the settings rail names what each pane holds (KAN-253)', () => {
  test('the five categories, in order, and none of the old names', () => {
    // Two pairs, then About: how it looks (Display, Language), then what it
    // does with your data (Sync & Backup, then Sessions -- the consequential
    // one first). Display stays the landing pane.
    expect(initialState.map((c) => c.name)).toEqual([
      'Display',
      'Language',
      'Sync & Backup',
      'Sessions',
      'About',
    ]);
    // The enum value is the i18n key (the rail renders t(name)), so each must
    // be a key -- keyCoverage cannot see t(variable).
    for (const { name } of initialState) expect(en).toHaveProperty(name);
    expect(en).not.toHaveProperty('Sync & Privacy');
    expect(en).not.toHaveProperty('Data Management');
  });

  test('Sessions holds Save Tab Groups and nothing about backup', async () => {
    await renderOn(SettingsCategory.SESSIONS);
    expect(screen.getByRole('group', { name: 'Save Tab Groups' })).toBeTruthy();
    expect(screen.queryByText('Backup')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Save sessions to a file' })
    ).toBeNull();
  });

  test('Sync & Backup holds Auto Sync, the status card, and the backup buttons', async () => {
    await renderOn(SettingsCategory.SYNC);
    expect(screen.getByRole('group', { name: 'Auto Sync' })).toBeTruthy();
    expect(screen.getByTestId('sync-status-card')).toBeTruthy();
    expect(screen.getByText('Backup')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save sessions to a file' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Replace sessions from a backup' })
    ).toBeTruthy();
    // And not the capture setting.
    expect(screen.queryByRole('group', { name: 'Save Tab Groups' })).toBeNull();
  });
});
