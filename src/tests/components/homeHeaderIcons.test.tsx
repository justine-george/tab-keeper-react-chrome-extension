import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { ICON } from '../../styles/scale';

// KAN-340 I1. The gear is the heaviest glyph in the row (20x20 of ink, 2.6x
// Sort's), so it alone draws at ICON.SMALL. Its BOX is unchanged; that is a
// layout fact jsdom cannot measure, so e2e/home-header.spec.ts owns it.

/** An ICON step as jsdom reports it: rem resolved against the 16px root. */
const px = (rem: string) => `${parseFloat(rem) * 16}px`;

function glyphSize(name: string): string {
  const glyph = screen
    .getByRole('button', { name })
    .querySelector('.material-symbols-outlined');
  if (glyph === null) throw new Error(`"${name}" has no ligature glyph`);
  return getComputedStyle(glyph).fontSize;
}

describe('home header glyph sizes (KAN-340 I1)', () => {
  test('Settings draws its gear at ICON.SMALL', async () => {
    await renderWithProviders(<MenuContainer />);

    expect(glyphSize('Settings')).toBe(px(ICON.SMALL));
  });

  // The guard against a blanket change: shrinking the whole row would pass
  // the test above.
  test('every other header icon stays at ICON.DEFAULT', async () => {
    await renderWithProviders(<MenuContainer />);

    for (const name of [
      'Open in a tab',
      'Sort sessions',
      'Undo',
      'Redo',
      'Sync now',
    ]) {
      expect({ name, size: glyphSize(name) }).toEqual({
        name,
        size: px(ICON.DEFAULT),
      });
    }
  });
});
