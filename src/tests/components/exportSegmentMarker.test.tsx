import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';
import { DARKENHEIMER_THEME, LIGHT_THEME } from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-199. In the Layout and Colour pairs, the pressed segment was marked only
// by its fill: SELECTION against PRIMARY, measured 1.47:1 on a light page and
// 1.28:1 on a dark one. WCAG 1.4.11 asks 3:1 of the cue that shows a control's
// state, and by eye the dark page gave no answer at all.
//
// The marker is a line along the bottom inside the pressed segment, in
// LABEL_L2 -- the quietest existing token that clears 3:1 on both pages. Not
// TEXT_COLOR: KAN-95 rejected that weight for a passive state marker, and
// measured here it is 6.9-7.3:1. The fill difference stays as a second cue.
//
// Drawn as an inset shadow, so it cannot move the box or spill outside it --
// the collision KAN-95 hit with an outline.

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

const markerOf = (name: string) =>
  getComputedStyle(screen.getByRole('button', { name })).boxShadow;

// jsdom computes an unset box-shadow to '', not 'none'; both mean unmarked.
const hasMarker = (button: Element) => {
  const shadow = getComputedStyle(button).boxShadow;
  return shadow !== '' && shadow !== 'none';
};

const marked = (groupName: string) =>
  within(screen.getByRole('group', { name: groupName }))
    .getAllByRole('button')
    .filter(hasMarker)
    .map((button) => button.getAttribute('aria-label'));

describe('the pressed segment carries a marker of its own (KAN-199)', () => {
  // Asserted at every segment, not only the pressed one: a build where all of
  // them are marked has no marker at all (KAN-95's lesson).
  test('exactly the pressed segment of each pair is marked', async () => {
    await renderUnder(Theme.LIGHT);

    // Compact since KAN-212 made it the opening layout. The Colour assertion is
    // unchanged even though that pair is now glyphs: `marked` reads aria-label,
    // which is exactly the property the icons had to keep.
    expect(marked('Layout')).toEqual(['Compact']);
    expect(marked('Colour')).toEqual(['Light']);
  });

  test('the marker moves with the choice', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Comfortable' }));
    expect(marked('Layout')).toEqual(['Comfortable']);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(marked('Colour')).toEqual(['Dark']);
  });

  test('the marker is drawn inside the segment, so it cannot move the row', async () => {
    await renderUnder(Theme.LIGHT);

    expect(markerOf('Compact')).toContain('inset');
    expect(
      getComputedStyle(screen.getByRole('button', { name: 'Compact' }))
        .outlineStyle
    ).toBe('none');
  });

  // A marker painted in the fill's own colour is invisible, and every test
  // above still passes with one: they ask whether a marker exists, not what
  // colour it is. This is what closes that gap at this level; the browser test
  // measures the rendered contrast.
  test('the marker is drawn in the marker colour, not the fill', async () => {
    await renderUnder(Theme.LIGHT);

    // jsdom reports the colour as written, lowercased: "inset 0 -2px 0
    // #6e7073". The rendered contrast is measured in session-export.spec.
    const marker = markerOf('Compact').toLowerCase();

    expect(marker).toContain(LIGHT_THEME.LABEL_L2_COLOR.toLowerCase());
    expect(marker).not.toContain(LIGHT_THEME.SELECTION_COLOR.toLowerCase());
  });

  test('a dark page marks it too', async () => {
    await renderUnder(Theme.DARKENHEIMER);

    expect(marked('Colour')).toEqual(['Dark']);
  });
});

// The numbers the fix exists for, at token level: the cue must clear 3:1
// against the fill it sits on, in both page palettes, and stay quieter than
// the text colour it replaced as a candidate.
describe('the marker reads on both page palettes (KAN-199)', () => {
  test.each([
    ['light', LIGHT_THEME],
    ['dark', DARKENHEIMER_THEME],
  ])('on a %s page the marker clears 3:1 on the pressed fill', (_, palette) => {
    const marker = contrast(palette.LABEL_L2_COLOR, palette.SELECTION_COLOR);

    expect(
      marker,
      `LABEL_L2 on SELECTION is ${marker.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(palette.TEXT_COLOR, palette.SELECTION_COLOR),
      'the marker stays quieter than TEXT_COLOR, rejected for this job in KAN-95'
    ).toBeGreaterThan(marker);
  });

  // What the fill alone gave, and why it could not be the only cue.
  test('CONTROL: the fill difference on its own is below 3:1', () => {
    for (const palette of [LIGHT_THEME, DARKENHEIMER_THEME]) {
      expect(
        contrast(palette.SELECTION_COLOR, palette.PRIMARY_COLOR)
      ).toBeLessThan(3);
    }
  });
});
