import { afterEach, describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { setPinTabKeeperInNewWindows } from '../../redux/slices/settingsDataStateSlice';

// KAN-459. Settings → Sessions → Pin Tab Keeper in new windows, after Default view.
const LABEL = 'Pin Tab Keeper in new windows';
const CAPTION =
  'Windows Tab Keeper opens or switches to start with Tab Keeper pinned.';

const renderSessions = (on = false) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed: { action: {} },
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SESSIONS));
      if (on) store.dispatch(setPinTabKeeperInNewWindows(true));
    },
  });

const pair = () => screen.getByRole('group', { name: LABEL });
const side = (name: 'On' | 'Off') =>
  within(pair()).getByRole('button', { name });
const sectionLabels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-settings-section]')].map(
    (section) => section.querySelector('span')?.textContent
  );
const savedSettings = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => localStorage.clear());

describe('the Pin Tab Keeper in new windows row', () => {
  test('sits after Default view, Off pressed, its caption describing the pair', async () => {
    const { container } = await renderSessions();
    expect(sectionLabels(container)).toEqual([
      'Save Tab Groups',
      'Bring back tab history when reopening',
      'Default view',
      LABEL,
      'Keyboard shortcut',
    ]);
    expect(side('Off')).toHaveAttribute('aria-pressed', 'true');
    expect(side('On')).toHaveAttribute('aria-pressed', 'false');
    expect(pair()).toHaveAccessibleDescription(CAPTION);
  });

  test('On turns it on and saves it; Off turns it off', async () => {
    const { store } = await renderSessions();
    await userEvent.click(side('On'));
    expect(store.getState().settingsDataState.pinTabKeeperInNewWindows).toBe(
      true
    );
    expect(savedSettings()).toMatchObject({ pinTabKeeperInNewWindows: true });
    await userEvent.click(side('Off'));
    expect(store.getState().settingsDataState.pinTabKeeperInNewWindows).toBe(
      false
    );
    expect(savedSettings()).toMatchObject({ pinTabKeeperInNewWindows: false });
  });

  test('a saved On shows On pressed', async () => {
    await renderSessions(true);
    expect(side('On')).toHaveAttribute('aria-pressed', 'true');
  });
});
