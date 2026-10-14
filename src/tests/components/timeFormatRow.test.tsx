import { afterEach, describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-587. Settings → Display → Time format, under Themes.
const renderDisplay = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) =>
      store.dispatch(selectCategory(SettingsCategory.DISPLAY)),
  });

const pair = () => screen.getByRole('group', { name: 'Time format' });
const side = (name: '12-hour' | '24-hour') =>
  within(pair()).getByRole('button', { name });
const savedSettings = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => localStorage.clear());

describe('the Time format row', () => {
  test('12-hour is pressed by default', async () => {
    await renderDisplay();
    expect(side('12-hour')).toHaveAttribute('aria-pressed', 'true');
    expect(side('24-hour')).toHaveAttribute('aria-pressed', 'false');
  });

  test('24-hour picks it and saves it; 12-hour picks it back', async () => {
    const { store } = await renderDisplay();
    await userEvent.click(side('24-hour'));
    expect(store.getState().settingsDataState.timeFormat).toBe('h23');
    expect(savedSettings()).toMatchObject({ timeFormat: 'h23' });
    await userEvent.click(side('12-hour'));
    expect(store.getState().settingsDataState.timeFormat).toBe('h12');
  });

  test('it has no help line', async () => {
    await renderDisplay();
    expect(pair()).not.toHaveAttribute('aria-describedby');
  });
});
