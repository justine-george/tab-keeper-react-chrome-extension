import { describe, expect, test, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { useDocumentTheme } from '../../hooks/useDocumentTheme';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';
import { DARKENHEIMER_THEME, LIGHT_THEME } from '../../hooks/useThemeColors';

// KAN-22. Two theming jobs that CSS-in-JS cannot do, both keyed on the same
// change, so both live in one hook on the document root:
//
//   1. Global pseudo-elements. ::-webkit-scrollbar cannot be styled from an
//      emotion class, so App.css reads custom properties this hook publishes.
//      The SCROLLBAR_* tokens already existed on all five themes and were
//      consumed by nothing.
//   2. Suppressing transitions during the switch. Seven components declare
//      `transition: background-color 0.2s` at the top level of their styles,
//      so changing theme animated every one of them over 200ms and read as lag.

const Probe = () => {
  useDocumentTheme();
  return null;
};

describe('useDocumentTheme (KAN-22)', () => {
  afterEach(() => {
    const root = document.documentElement;
    root.removeAttribute('data-theme-switching');
    root.removeAttribute('style');
  });

  test('publishes the active theme scrollbar colours as custom properties', async () => {
    await renderWithProviders(<Probe />);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--scrollbar-track')).toBe(
      LIGHT_THEME.SCROLLBAR_TRACK
    );
    expect(root.style.getPropertyValue('--scrollbar-thumb')).toBe(
      LIGHT_THEME.SCROLLBAR_THUMB
    );
    expect(root.style.getPropertyValue('--scrollbar-thumb-hover')).toBe(
      LIGHT_THEME.SCROLLBAR_THUMB_HOVER
    );
  });

  // The bug the hardcoded #f0f2f5 / #888 caused: the scrollbar stayed light
  // grey in every theme, including the two dark ones.
  test('republishes them when the theme changes', async () => {
    const { store } = await renderWithProviders(<Probe />);

    act(() => {
      store.dispatch(setTheme(Theme.DARKENHEIMER));
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--scrollbar-track')).toBe(
      DARKENHEIMER_THEME.SCROLLBAR_TRACK
    );
    expect(root.style.getPropertyValue('--scrollbar-thumb')).toBe(
      DARKENHEIMER_THEME.SCROLLBAR_THUMB
    );
  });

  // The flag must be set in the SAME commit that changes the colours, not a
  // frame later -- one frame late and the transition has already started, which
  // is the whole defect.
  test('marks the document as switching synchronously with the theme change', async () => {
    const { store } = await renderWithProviders(<Probe />);

    await waitFor(() => {
      expect(
        document.documentElement.hasAttribute('data-theme-switching')
      ).toBe(false);
    });

    act(() => {
      store.dispatch(setTheme(Theme.BLUE));
    });

    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(
      true
    );
  });

  // ...and must clear it again, or every hover transition in the app stays
  // dead for the rest of the session -- a worse bug than the one being fixed.
  test('clears the switching flag once the new colours have painted', async () => {
    const { store } = await renderWithProviders(<Probe />);

    act(() => {
      store.dispatch(setTheme(Theme.BB_PINK));
    });

    await waitFor(() => {
      expect(
        document.documentElement.hasAttribute('data-theme-switching')
      ).toBe(false);
    });
  });
});
