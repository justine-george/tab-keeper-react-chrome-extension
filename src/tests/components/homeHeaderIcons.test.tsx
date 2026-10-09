import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { ICON } from '../../styles/scale';

// KAN-340. Two glyphs in the row read wrong at DEFAULT: the gear (the
// heaviest ink) and open_in_full (thin, but reaching its corners). The gear
// draws at ICON.MEDIUM (Justine's pick after SMALL read too small); open_in_full
// and Open compact view draw at ICON.MEDIUM_SMALL (KAN-437, pick B). Their BOXES are
// unchanged; that is a layout fact jsdom cannot measure, so
// e2e/home-header.spec.ts owns it.

/** An ICON step as jsdom reports it: rem resolved against the 16px root. */
const px = (rem: string) => `${parseFloat(rem) * 16}px`;

function glyphSize(name: string): string {
  const glyph = screen
    .getByRole('button', { name })
    .querySelector('.material-symbols-outlined');
  if (glyph === null) throw new Error(`"${name}" has no ligature glyph`);
  return getComputedStyle(glyph).fontSize;
}

describe('home header glyph sizes (KAN-340)', () => {
  test('Settings draws at ICON.MEDIUM', async () => {
    await renderWithProviders(<MenuContainer />);
    expect(glyphSize('Settings')).toBe(px(ICON.MEDIUM));
  });

  // KAN-437 pick B: the arrows reach their corners, so they draw a step under the gear.
  test('Open full view draws at ICON.MEDIUM_SMALL', async () => {
    await renderWithProviders(<MenuContainer />);
    expect(glyphSize('Open full view')).toBe(px(ICON.MEDIUM_SMALL));
  });

  test('in the full view, Open compact view draws at ICON.MEDIUM_SMALL, as Open full view does (KAN-437)', async () => {
    history.replaceState(null, '', '?view=tab');
    try {
      await renderWithProviders(<MenuContainer />);

      expect(glyphSize('Open compact view')).toBe(px(ICON.MEDIUM_SMALL));
    } finally {
      history.replaceState(null, '', '?');
    }
  });

  // The guard against a blanket change: resizing the whole row would pass
  // the tests above.
  test.each([
    ['popup', '?'],
    ['full view', '?view=tab'],
  ])(
    'in the %s, every other header icon stays at ICON.DEFAULT',
    async (_view, search) => {
      history.replaceState(null, '', search);
      try {
        await renderWithProviders(<MenuContainer />);

        // The default store is signed out, so the sync button is dimmed and
        // named for why (KAN-342).
        for (const name of [
          'Sort sessions',
          'Undo',
          'Redo',
          'Sync unavailable',
        ]) {
          expect({ name, size: glyphSize(name) }).toEqual({
            name,
            size: px(ICON.DEFAULT),
          });
        }
      } finally {
        history.replaceState(null, '', '?');
      }
    }
  );
});
