import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { ICON } from '../../styles/scale';

// KAN-340. Two glyphs in the row read wrong at DEFAULT: the gear (the
// heaviest ink) and open_in_full (thin, but reaching its corners). Both draw
// at ICON.MEDIUM, picked by Justine from a side-by-side mock after SMALL made
// the gear read too small. Their BOXES are unchanged; that is a layout fact
// jsdom cannot measure, so e2e/home-header.spec.ts owns it.

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
  test('Settings and Open full view draw at ICON.MEDIUM', async () => {
    await renderWithProviders(<MenuContainer />);

    for (const name of ['Settings', 'Open full view']) {
      expect({ name, size: glyphSize(name) }).toEqual({
        name,
        size: px(ICON.MEDIUM),
      });
    }
  });

  // The guard against a blanket change: resizing the whole row would pass
  // the test above.
  test('every other header icon stays at ICON.DEFAULT', async () => {
    await renderWithProviders(<MenuContainer />);

    // The default store is signed out, so the sync button is dimmed and
    // named for why (KAN-342).
    for (const name of ['Sort sessions', 'Undo', 'Redo', 'Sync unavailable']) {
      expect({ name, size: glyphSize(name) }).toEqual({
        name,
        size: px(ICON.DEFAULT),
      });
    }
  });
});
