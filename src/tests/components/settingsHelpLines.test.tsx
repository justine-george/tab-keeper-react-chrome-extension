import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-860. Four settings said nothing about what they do. Each gets a help
// line under its control, as Default save has, and the control is described
// by it, so a screen reader hears the line with the control.

const renderOn = (category: SettingsCategory) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(category));
    },
  });

const AUTO_SYNC_HELP =
  'Syncs your sessions across your Chrome devices. Settings stay separate on each device.';
const BACKUP_HELP =
  'Saves your sessions to a file. Settings aren’t included. Loading a backup asks whether to merge it with your sessions or replace them.';
const CLOUD_DATA_HELP =
  'Removes your sessions from the cloud and turns Auto sync off. Your sessions stay on this device and on your other devices.';
const SAVE_TAB_GROUPS_HELP =
  'Saved sessions keep each tab group’s name and colour, and the groups come back when you reopen the session.';

describe('settings help lines (KAN-860)', () => {
  test('Sync & Backup: Auto sync, Backup and Cloud data each describe their controls', async () => {
    await renderOn(SettingsCategory.SYNC);

    const autoSync = screen.getByRole('group', { name: 'Auto sync' });
    expect(autoSync).toHaveAccessibleDescription(AUTO_SYNC_HELP);
    expect(screen.getByText(AUTO_SYNC_HELP).tagName).toBe('P');

    for (const name of [
      'Save sessions to a file',
      'Load sessions from a backup',
    ]) {
      expect(screen.getByRole('button', { name })).toHaveAccessibleDescription(
        BACKUP_HELP
      );
    }

    expect(
      screen.getByRole('button', { name: 'Delete cloud data' })
    ).toHaveAccessibleDescription(CLOUD_DATA_HELP);
  });

  test('each help line sits in its own setting’s section', async () => {
    await renderOn(SettingsCategory.SYNC);
    const sectionOf = (text: string) =>
      screen.getByText(text).closest('[data-settings-section]') as HTMLElement;

    expect(
      within(sectionOf(AUTO_SYNC_HELP)).getByRole('group', {
        name: 'Auto sync',
      })
    ).toBeTruthy();
    expect(
      within(sectionOf(BACKUP_HELP)).getByRole('button', {
        name: 'Load sessions from a backup',
      })
    ).toBeTruthy();
    expect(
      within(sectionOf(CLOUD_DATA_HELP)).getByRole('button', {
        name: 'Delete cloud data',
      })
    ).toBeTruthy();
  });

  test('Sessions: Save tab groups describes its pair, without mentioning permission', async () => {
    await renderOn(SettingsCategory.SESSIONS);

    const pair = screen.getByRole('group', { name: 'Save tab groups' });
    expect(pair).toHaveAccessibleDescription(SAVE_TAB_GROUPS_HELP);
    expect(SAVE_TAB_GROUPS_HELP).not.toMatch(/permission/i);
  });
});
