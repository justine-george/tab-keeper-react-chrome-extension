import { afterEach, describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { setDefaultSaveScope } from '../../redux/slices/settingsDataStateSlice';
import type { CaptureScope } from '../../utils/functions/capture';

// KAN-635. Settings → Sessions → Default save: two tiles drawn as the home save box, first in Sessions.
const LABEL = 'Default save';
// The en text, ⋮ held to its neighbours by no-break spaces.
const HELP =
  'Used by the save button and the Enter key. The other save is in the\u00a0⋮\u00a0menu.';

const renderSessions = (scope?: CaptureScope) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed: { action: {} },
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SESSIONS));
      if (scope) store.dispatch(setDefaultSaveScope(scope));
    },
  });

const group = () => screen.getByRole('radiogroup', { name: LABEL });
const choice = (name: 'All windows' | 'Current window') =>
  within(group()).getByRole('radio', { name });
const glyphs = (radio: HTMLElement) =>
  [...radio.closest('label')!.querySelectorAll<Element>('[data-icon]')].map(
    (g) => g.getAttribute('data-icon')
  );
const sectionLabels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-settings-section]')].map(
    (section) => section.querySelector('span')?.textContent
  );
const savedSettings = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => localStorage.clear());

describe('the Default save row', () => {
  test('is the first section in Sessions, all windows chosen, its help line describing it', async () => {
    const { container } = await renderSessions();
    expect(sectionLabels(container)[0]).toBe(LABEL);
    expect(sectionLabels(container)[1]).toBe('Save tab groups');
    expect(choice('All windows')).toBeChecked();
    expect(choice('Current window')).not.toBeChecked();
    expect(group()).toHaveAccessibleDescription(HELP);
  });

  test('each tile is its save box: the save’s glyph, then ⋮', async () => {
    await renderSessions();
    expect(glyphs(choice('All windows'))).toEqual([
      'two_windows_add',
      'more_vert',
    ]);
    expect(glyphs(choice('Current window'))).toEqual([
      'window_add',
      'more_vert',
    ]);
  });

  test('a saved current window shows chosen', async () => {
    await renderSessions('current-window');
    expect(choice('Current window')).toBeChecked();
    expect(choice('All windows')).not.toBeChecked();
  });

  test('a click on a tile’s ⋮ chooses that tile and saves it', async () => {
    const { store, container } = await renderSessions();
    const dots = choice('Current window')
      .closest('label')!
      .querySelector<HTMLElement>('[data-icon="more_vert"]')!;
    await userEvent.click(dots);
    expect(store.getState().settingsDataState.defaultSaveScope).toBe(
      'current-window'
    );
    expect(savedSettings()).toMatchObject({
      defaultSaveScope: 'current-window',
    });
    expect(choice('Current window')).toBeChecked();
    // The ⋮ is a drawing here: nothing in the row opens a menu.
    expect(within(container).queryByRole('menu')).toBeNull();
  });

  test('a click on the word chooses back', async () => {
    const { store } = await renderSessions('current-window');
    // The visible word; its hidden bold copy only holds the width (KAN-801).
    await userEvent.click(
      screen.getByText('All windows', { ignore: '[aria-hidden="true"]' })
    );
    expect(store.getState().settingsDataState.defaultSaveScope).toBe(
      'all-windows'
    );
  });

  test('one tab stop; an arrow key moves the choice', async () => {
    const { store } = await renderSessions();
    choice('All windows').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(choice('Current window')).toHaveFocus();
    expect(store.getState().settingsDataState.defaultSaveScope).toBe(
      'current-window'
    );
    await userEvent.keyboard('{ArrowLeft}');
    expect(store.getState().settingsDataState.defaultSaveScope).toBe(
      'all-windows'
    );
  });
});
