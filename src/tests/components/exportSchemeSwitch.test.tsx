import { describe, expect, test } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';

// KAN-201. Pressing Light or Dark washed the toolbar out for 200ms: Button and
// Icon fade their background (transition: background-color 0.2s) while their
// text and icons switch instantly, so every control wore the old palette's
// fill under the new palette's text. The popup never shows this -- KAN-22
// suppresses transitions for the frame of a theme swap -- but that lives in
// App.css, which the export page does not load.
//
// Same answer, carried to this page: a marker while the palette changes, and
// a rule that kills transitions while it is set.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderUnder = (theme: Theme) =>
  renderWithProviders(<ExportPage tabGroupId="session-kyoto" />, {
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
      store.dispatch(setTheme(theme));
    },
  });

const frame = () => document.querySelector('iframe') as HTMLIFrameElement;

describe('switching the page light or dark does not flicker (KAN-201)', () => {
  test('the palette change is marked while it happens, and released after', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);
    expect(
      document.documentElement.hasAttribute('data-scheme-switching'),
      'nothing is switching at rest'
    ).toBe(false);

    // Watched, not polled. The marker lives for two frames, and this used to
    // read it once after `await user.click` -- which, under a loaded full
    // suite, sometimes returned after those frames had passed (KAN-219). The
    // observer records the moment the marker goes on, and what the controls
    // looked like at that moment.
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

    // Set, and by then the controls already wore the dark palette: the marker
    // is on in the same commit that repaints them.
    expect(fillWhenMarked, 'the marker was set').toBe('rgb(42, 42, 42)');
  });

  // The rule the marker exists for. Without it the marker marks nothing.
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

// The frame is a white box until the document inside it paints, which on a
// dark page is a flash of white on load and on reload.
describe('the preview frame takes the file ground (KAN-201)', () => {
  test.each([
    [Theme.LIGHT, 'rgb(255, 255, 255)'],
    [Theme.DARKENHEIMER, 'rgb(23, 23, 23)'],
  ])('on %s the frame is the file ground', async (theme, ground) => {
    await renderUnder(theme);

    expect(getComputedStyle(frame()).backgroundColor).toBe(ground);
  });
});
