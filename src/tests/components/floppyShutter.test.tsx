import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';

import WelcomeHero from '../../components/modals/WelcomeHero';
import TabKeeperMark from '../../components/common/TabKeeperMark';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setTheme } from '../../redux/slices/settingsDataStateSlice';
import { Theme } from '../../utils/constants/theme';

// KAN-627. A floppy's slot is cut into its metal shutter: the whole shutter slides, never the slot alone.

describe('the floppy shutter carries its slot (KAN-627)', () => {
  test('the welcome hero: the slot is inside the part that slides', async () => {
    await renderWithProviders(<WelcomeHero frame="end" />);
    const shutter = document.querySelector('[data-hero-part="shutter"]');
    const slot = document.querySelector('[data-hero-part="slot"]');
    expect(shutter).not.toBeNull();
    expect(slot).not.toBeNull();
    expect(shutter?.contains(slot ?? null)).toBe(true);
    expect(shutter).not.toBe(slot);
  });

  test('the header mark: the slot and the cream plate slide together', () => {
    render(<TabKeeperMark />);
    const shutter = document.querySelector('[data-mark-part="shutter"]');
    const slot = document.querySelector('[data-mark-part="slot"]');
    expect(shutter?.tagName).toBe('g');
    expect(shutter?.contains(slot ?? null)).toBe(true);
    expect(shutter?.querySelector('rect[fill="#f4eae2"]')).not.toBeNull();
  });

  test('Graphite: the hero draws a near-black disk with light parts, not the text colour', async () => {
    await renderWithProviders(<WelcomeHero frame="end" />, {
      seedStore: (store) => store.dispatch(setTheme(Theme.DARKENHEIMER)),
    });
    const floppy = document.querySelector('[data-hero-part="floppy"]');
    const shutter = document.querySelector('[data-hero-part="shutter"]');
    if (floppy === null || shutter === null) throw new Error('not drawn');
    expect(getComputedStyle(floppy).backgroundColor).toBe('rgb(19, 19, 19)');
    expect(getComputedStyle(shutter).backgroundColor).toBe(
      'rgb(208, 208, 208)'
    );
  });
});
