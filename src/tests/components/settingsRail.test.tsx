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

// Each settings section's label -- the first text a section draws.
const sectionLabels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-settings-section]')].map(
    (section) => section.querySelector('span')?.textContent
  );

const renderOn = (category: SettingsCategory) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(category));
    },
  });

describe('the settings rail names what each pane holds (KAN-253)', () => {
  test('the eight categories, in order, and none of the old names', () => {
    // Two pairs, then About and Help: how it looks (Display, Language), then
    // what it does with your data (Sync & Backup, then Sessions -- the
    // consequential one first). Display stays the landing pane. Recently
    // deleted follows Sessions (KAN-595). Quick access follows Language
    // (KAN-652): how Tab Keeper itself opens, before anything about data.
    expect(initialState.map((c) => c.name)).toEqual([
      'Display',
      'Language',
      'Quick access',
      'Sync & Backup',
      'Sessions',
      'Recently deleted',
      'About',
      'Help',
    ]);
    // The enum value is the i18n key (the rail renders t(name)), so each must
    // be a key -- keyCoverage cannot see t(variable).
    for (const { name } of initialState) expect(en).toHaveProperty(name);
    expect(en).not.toHaveProperty('Sync & Privacy');
    expect(en).not.toHaveProperty('Data Management');
  });

  test('Sync & Backup holds Auto Sync, the status card, and the backup buttons', async () => {
    await renderOn(SettingsCategory.SYNC);
    expect(screen.getByRole('group', { name: 'Auto sync' })).toBeTruthy();
    expect(screen.getByTestId('sync-status')).toBeTruthy();
    expect(screen.getByText('Backup')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save sessions to a file' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Load sessions from a backup' })
    ).toBeTruthy();
    // And not the capture setting.
    expect(screen.queryByRole('group', { name: 'Save tab groups' })).toBeNull();
  });

  // KAN-652. Sessions held six settings, three of them about how Tab Keeper
  // itself opens, which nobody looks for under "Sessions".
  test('Sessions holds what a save does and what a copy pastes; Quick access holds how Tab Keeper opens', async () => {
    const { container, unmount } = await renderOn(SettingsCategory.SESSIONS);
    // KAN-663: tab history is always on, so it has no row. KAN-859 added Copy links.
    expect(sectionLabels(container)).toEqual([
      'Default save',
      'Save tab groups',
      'Copy links',
    ]);
    unmount();

    const quick = await renderOn(SettingsCategory.QUICK_ACCESS);
    expect(sectionLabels(quick.container)).toEqual([
      'Default view',
      'Pin Tab Keeper in new windows',
      'Keyboard shortcut',
    ]);
  });
});

// KAN-253. The About pane puts 32px between its blocks (KAN-241); the other
// panes stacked their sections at 20px, and the Sync & Backup pane -- three
// sections, since Backup moved in -- read as crowded beside it. Sections
// after the first now sit 32px apart on every pane; the first keeps its 20px
// from the pane top, as About's nameplate does.
describe('sections within a pane sit 32px apart, as About blocks do', () => {
  test('Sync & Backup: first at 20px from the top, the rest at 32px', async () => {
    const { container } = await renderOn(SettingsCategory.SYNC);
    const margins = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((el) => getComputedStyle(el).marginTop);
    expect(margins).toEqual(['20px', '32px', '32px', '32px']);
  });

  test('Sessions: first at 20px, every later row at 32px', async () => {
    const { container } = await renderOn(SettingsCategory.SESSIONS);
    const margins = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((el) => getComputedStyle(el).marginTop);
    expect(margins).toEqual(['20px', '32px', '32px']);
  });

  test('Quick access: first at 20px, every later row at 32px', async () => {
    const { container } = await renderOn(SettingsCategory.QUICK_ACCESS);
    const margins = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((el) => getComputedStyle(el).marginTop);
    expect(margins).toEqual(['20px', '32px', '32px']);
  });
});
