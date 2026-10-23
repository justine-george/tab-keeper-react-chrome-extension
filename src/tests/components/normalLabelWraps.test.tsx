import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import { NormalLabel } from '../../components/common/Label';
import SettingsCategoryContainer from '../../components/settings/leftpane/SettingsCategoryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-754. A label that wraps goes onto more lines; every other label stays on
// one line and ends in an ellipsis, as before.

describe('NormalLabel', () => {
  test('by default the value stays on one line, ending in an ellipsis', async () => {
    await renderWithProviders(<NormalLabel value="Recently deleted" />);
    expect(screen.getByText('Recently deleted')).toHaveStyle({
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });
  });

  test('wraps: the value goes onto more lines, with no ellipsis', async () => {
    await renderWithProviders(<NormalLabel value="Recently deleted" wraps />);
    const text = screen.getByText('Recently deleted');
    expect(text).not.toHaveStyle({ whiteSpace: 'nowrap' });
    expect(text).not.toHaveStyle({ textOverflow: 'ellipsis' });
    expect(text.parentElement).toHaveStyle({ whiteSpace: 'normal' });
  });

  test("the Settings rail's labels wrap", async () => {
    await renderWithProviders(<SettingsCategoryContainer />);
    expect(screen.getByText('Recently deleted')).not.toHaveStyle({
      whiteSpace: 'nowrap',
    });
  });
});
