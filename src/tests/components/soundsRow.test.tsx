import { afterEach, describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { setUiSoundOn } from '../../redux/slices/settingsDataStateSlice';

// Settings → Display → Sounds: the Off/On pair under Themes, saved device-local.

const CAPTION = 'Play sounds as you use Tab Keeper.';

const renderDisplay = (soundOn = true) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.DISPLAY));
      if (!soundOn) store.dispatch(setUiSoundOn(false));
    },
  });

const pair = () => screen.getByRole('group', { name: 'Sounds' });
const side = (name: 'On' | 'Off') =>
  within(pair()).getByRole('button', { name });
const sectionLabels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-settings-section]')].map(
    (section) => section.querySelector('span')?.textContent
  );
const savedSettings = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => {
  localStorage.clear();
});

describe('the Sounds row', () => {
  test('sits directly under Themes, On pressed by default, its caption describing the pair', async () => {
    const { container } = await renderDisplay();
    expect(sectionLabels(container)).toEqual(['Themes', 'Sounds']);
    expect(side('On')).toHaveAttribute('aria-pressed', 'true');
    expect(side('Off')).toHaveAttribute('aria-pressed', 'false');
    expect(pair()).toHaveAccessibleDescription(CAPTION);
  });

  test('Off turns sounds off and saves it; On turns them back on', async () => {
    const { store } = await renderDisplay();
    await userEvent.click(side('Off'));
    expect(store.getState().settingsDataState.isUiSoundOn).toBe(false);
    expect(savedSettings()).toMatchObject({ isUiSoundOn: false });
    expect(side('Off')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(side('On'));
    expect(store.getState().settingsDataState.isUiSoundOn).toBe(true);
    expect(savedSettings()).toMatchObject({ isUiSoundOn: true });
    expect(side('On')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a saved Off shows Off pressed', async () => {
    await renderDisplay(false);
    expect(side('Off')).toHaveAttribute('aria-pressed', 'true');
    expect(side('On')).toHaveAttribute('aria-pressed', 'false');
  });
});
