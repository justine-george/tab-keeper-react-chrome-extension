import { afterEach, describe, expect, test } from 'vitest';
import { renderHook, screen } from '@testing-library/react';
import { Provider } from 'react-redux';

import { FakeMediaQueryList } from '../setup/mediaQueryFake';

import { makeTestStore } from '../setup/makeStore';
import { renderWithProviders } from '../setup/renderWithProviders';
import { applyOtherPageSettings } from '../../redux/otherPageChanges';
import {
  CHALK_THEME,
  CHARCOAL_THEME,
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

  test('Graphite, Ink and Charcoal are the dark themes; the other four are light', () => {
    expect(
      Object.values(Theme)
        .filter((theme) => isDarkTheme(theme))
        .sort()
    ).toEqual([Theme.BLUE, Theme.CHARCOAL, Theme.DARKENHEIMER].sort());
  });

  // KAN-731. The hook maps each stored theme to its own table; a stored theme
  // it does not know falls back to the default (below).
  test.each([
    [Theme.CHALK, CHALK_THEME],
    [Theme.CHARCOAL, CHARCOAL_THEME],
  ])('a stored %s theme reads its own table', async (theme, table) => {
    await renderWithProviders(<Probe />, {
      seedStore: (store) => store.dispatch(setTheme(theme)),
    });

    expect(screen.getByTestId('probe').textContent).toBe(table.SECONDARY_COLOR);
  });

  // KAN-731. Another page writes a theme this build never shipped: this page reads the default.
  describe.each([
    ['light OS', false, Theme.CHALK, CHALK_THEME],
    ['dark OS', true, Theme.CHARCOAL, CHARCOAL_THEME],
  ])('an unknown theme written on a %s', (_os, dark, fallback, table) => {
    const original = window.matchMedia;
    afterEach(() => {
      window.matchMedia = original;
      localStorage.clear();
    });

    test('reads the default table', () => {
      window.matchMedia = (q: string) => new FakeMediaQueryList(q, dark);
      const { store } = makeTestStore();
      localStorage.setItem(
        'settingsData',
        JSON.stringify({
          ...store.getState().settingsDataState,
          theme: 'Nonsense',
        })
      );
      store.dispatch(applyOtherPageSettings());

      expect(store.getState().settingsDataState.theme).toBe(fallback);
      const { result } = renderHook(() => useThemeColors(), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });
      expect(result.current).toBe(table);
    });
  });
});
