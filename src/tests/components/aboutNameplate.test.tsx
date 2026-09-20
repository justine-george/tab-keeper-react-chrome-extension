import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { APP_VERSION } from '../../utils/constants/common';
import { TYPE } from '../../styles/scale';

// KAN-241. Settings -> About is a nameplate over the same section anatomy the
// other four panes use.
//
// It was the one pane laid out differently: centred, a SECTION heading that
// thanked the user, and the version at the floor in LABEL_L3 -- the marker
// token, 2.56:1 on Paper -- so the one line a bug report needs was the hardest
// on the page to read.
//
// jsdom lays out nothing, so the inset and the stack are measured by the e2e
// spec (about-nameplate.spec.ts). What is pinned here is the contract: which
// glyph, which tokens, which strings.

/** A colour as emotion wrote it, or as jsdom normalises it. */
const asWritten = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
};

/** A TYPE step as jsdom reports it: rem resolved against the 16px root. */
const px = (rem: string) => `${parseFloat(rem) * 16}px`;

const renderAbout = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.ABOUT));
    },
  });

describe('the About nameplate', () => {
  test('draws the mark as a one-colour path in the text colour, hidden from AT', async () => {
    const { container } = await renderAbout();

    // Not the share button's X: the nameplate's mark is the svg that sits in
    // no button. Without this filter the test passed against the old page.
    const svg =
      Array.from(container.querySelectorAll('svg')).find(
        (s) => s.closest('button') === null
      ) ?? null;
    expect(svg).not.toBeNull();
    // A real path, not an empty element that happens to be an <svg>.
    expect(svg!.querySelector('path')?.getAttribute('d')).toMatch(/^M[\d.]/);
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    // fill="currentColor" against the page's ink, the way every glyph is.
    expect(svg!.getAttribute('fill')).toBe('currentColor');
    expect(getComputedStyle(svg!).color).toMatch(
      asWritten(LIGHT_THEME.TEXT_COLOR)
    );
  });

  // The mark is not the X share glyph borrowed for the job. Both are brand
  // marks drawn through the same table, so the wrong one is one typo away and
  // the assertion above would not notice.
  test('the mark is not the X glyph', async () => {
    const { container } = await renderAbout();

    const paths = Array.from(container.querySelectorAll('svg path')).map((p) =>
      p.getAttribute('d')
    );
    // The share button's own X glyph is still on the page ...
    expect(paths.some((d) => d?.startsWith('M18.244'))).toBe(true);
    // ... and the nameplate's mark is a different path.
    expect(paths.filter((d) => !d?.startsWith('M18.244'))).toHaveLength(1);
  });

  test('names the product at SECTION size in the text colour', async () => {
    await renderAbout();

    const name = screen.getByText('Tab Keeper');
    expect(getComputedStyle(name).fontSize).toBe(px(TYPE.SECTION));
    expect(getComputedStyle(name).color).toMatch(
      asWritten(LIGHT_THEME.TEXT_COLOR)
    );
  });

  // The whole point. LABEL_L3 is the marker token, and the version is the one
  // line a bug report has to be able to read.
  test('sets the version in LABEL_L1, not the L3 marker token', async () => {
    await renderAbout();

    const version = screen.getByText(`v${APP_VERSION}`);
    expect(getComputedStyle(version).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L1_COLOR)
    );
    expect(getComputedStyle(version).fontSize).toBe(px(TYPE.SECONDARY));
  });

  test('sets the credit in LABEL_L2 at SECONDARY size', async () => {
    await renderAbout();

    const credit = screen.getByText(/Crafted with/);
    expect(getComputedStyle(credit).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L2_COLOR)
    );
    expect(getComputedStyle(credit).fontSize).toBe(px(TYPE.SECONDARY));
  });

  test('drops the thank-you heading', async () => {
    await renderAbout();

    expect(screen.queryByText(/Thank you for using/)).toBeNull();
  });

  test('keeps the three actions, under one section label', async () => {
    await renderAbout();

    expect(screen.getByText('Feedback & Share')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Rate this extension' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Share your feedback' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share on X' })).toBeTruthy();
  });
});
