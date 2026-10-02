import { describe, expect, test } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';

// Controls fade their background (0.2s) but switch text instantly, so a scheme
// swap shows old fill under new text. The popup's fix is in App.css, which this
// page does not load, so it carries its own marker and transition-off rule.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderUnder = (theme: Theme) =>
  renderWithProviders(
    <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
        store.dispatch(setTheme(theme));
      },
    }
  );

const frame = () => document.querySelector('iframe') as HTMLIFrameElement;

describe('switching the page light or dark does not flicker (KAN-201)', () => {
  test('the palette change is marked while it happens, and released after', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);
    expect(
      document.documentElement.hasAttribute('data-scheme-switching'),
      'nothing is switching at rest'
    ).toBe(false);

    // Watched, not polled: the marker lives two frames, and a loaded suite can
    // return from the click after both (KAN-219).
    const root = document.documentElement;
    let fillWhenMarked: string | undefined;
    const observer = new MutationObserver(() => {
      if (
        fillWhenMarked === undefined &&
        root.hasAttribute('data-scheme-switching')
      ) {
        fillWhenMarked = getComputedStyle(
          screen.getByRole('button', { name: 'Copy all links' })
        ).backgroundColor;
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-scheme-switching'],
    });

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    await waitFor(() =>
      expect(root.hasAttribute('data-scheme-switching')).toBe(false)
    );
    observer.disconnect();

    // The marker goes on in the same commit that repaints the controls dark.
    expect(fillWhenMarked, 'the marker was set').toBe('rgb(42, 42, 42)');
  });

  test('while marked, transitions are off', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    const rules = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .map((rule) => rule.cssText)
      .filter(
        (text) =>
          text.includes('data-scheme-switching') && text.includes('transition')
      );

    expect(rules.join('\n')).toMatch(/transition:\s*none/i);
  });
});

// An unpainted frame is white, a flash on a dark page.
describe('the preview frame takes the file ground (KAN-201)', () => {
  test.each([
    [Theme.LIGHT, 'rgb(255, 255, 255)'],
    [Theme.DARKENHEIMER, 'rgb(23, 23, 23)'],
  ])('on %s the frame is the file ground', async (theme, ground) => {
    await renderUnder(theme);

    expect(getComputedStyle(frame()).backgroundColor).toBe(ground);
  });
});
