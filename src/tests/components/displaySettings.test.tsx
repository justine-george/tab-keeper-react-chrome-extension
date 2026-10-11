import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

describe('Settings → Display', () => {
  test('holds Themes only: no Sounds row (KAN-515)', async () => {
    const { container } = await renderWithProviders(
      <SettingsDetailsContainer />,
      {
        seedStore: (store) =>
          store.dispatch(selectCategory(SettingsCategory.DISPLAY)),
      }
    );
    const labels = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((section) => section.querySelector('span')?.textContent);
    expect(labels).toEqual(['Themes']);
    expect(screen.queryByRole('group', { name: 'Sounds' })).toBeNull();
  });
});
