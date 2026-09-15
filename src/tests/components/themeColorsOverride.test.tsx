import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '../setup/renderWithProviders';
import {
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  ThemeColorsOverride,
  isDarkTheme,
  useThemeColors,
} from '../../hooks/useThemeColors';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';

// KAN-198. The export page is light or dark on its own terms -- it opens on the
// extension theme's polarity, and its Light/Dark switch changes only itself. So
// its shared components (Button, Icon, Toast) need colours that are not the
// extension theme's, without the page ever writing the theme. A context the
// colour hook checks first is that channel; outside it, nothing changes.

function Probe() {
  const COLORS = useThemeColors();
  return <span data-testid="probe">{COLORS.SECONDARY_COLOR}</span>;
}

describe('overriding the theme colours for one subtree (KAN-198)', () => {
  test('inside an override, components get the override colours, not the theme', async () => {
    await renderWithProviders(
      <ThemeColorsOverride.Provider value={DARKENHEIMER_THEME}>
        <Probe />
      </ThemeColorsOverride.Provider>,
      { seedStore: (store) => store.dispatch(setTheme(Theme.LIGHT)) }
    );

    expect(screen.getByTestId('probe').textContent).toBe(
      DARKENHEIMER_THEME.SECONDARY_COLOR
    );
  });

  // CONTROL: without a provider -- the popup, and everything else -- the hook
  // still follows the extension theme.
  test('outside an override, components follow the extension theme as before', async () => {
    await renderWithProviders(<Probe />, {
      seedStore: (store) => store.dispatch(setTheme(Theme.LIGHT)),
    });

    expect(screen.getByTestId('probe').textContent).toBe(
      LIGHT_THEME.SECONDARY_COLOR
    );
  });

  test('Darkenheimer and Blue are the dark themes; the other three are light', () => {
    expect(
      Object.values(Theme)
        .filter((theme) => isDarkTheme(theme))
        .sort()
    ).toEqual([Theme.BLUE, Theme.DARKENHEIMER].sort());
  });
});
