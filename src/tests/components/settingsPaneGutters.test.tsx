import { describe, expect, test } from 'vitest';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// Every settings section insets its content with
// `padding-left: clamp(16px, 8%, 72px)` and reserved nothing on the right, so
// the pane's content sat off-centre: measured in a browser on the Language
// section, the left gutter was 50px and the right 9px.
//
// Asserted as left === right rather than a pixel value, because the inset is a
// clamp against the pane's own width -- pinning a number would pin the viewport
// the test happened to run at.
describe('the settings pane insets its content evenly', () => {
  const sectionsUnderTest = [
    ['Display', SettingsCategory.DISPLAY],
    ['Sync & Privacy', SettingsCategory.SYNC],
    ['Data Management', SettingsCategory.DATA_MANAGEMENT],
    ['Language', SettingsCategory.LANGUAGE],
    // About is deliberately absent: it centres its content with
    // `align-items: center` and carries no inset at all, so it has no gutters
    // to balance. Asserting one here demanded an element that should not exist.
  ] as const;

  test.each(sectionsUnderTest)(
    'the %s section reserves the same gutter on both sides',
    async (_name, category) => {
      const { container } = await renderWithProviders(
        <SettingsDetailsContainer />,
        { seedStore: (store) => store.dispatch(selectCategory(category)) }
      );

      // Identified by the clamp's own floor (16px), not by the literal string
      // "clamp" -- jsdom resolves the function, so a substring match finds
      // nothing and an earlier version of this fell back to EVERY padded div,
      // catching a 4px/8px button that is asymmetric for its own good reasons.
      const isInset = (d: Element) => {
        const pl = getComputedStyle(d).paddingLeft;
        // jsdom returns the literal clamp() string; a browser resolves it to
        // px. Accept both, so this test does not depend on which one runs it.
        return pl.includes('clamp') || parseFloat(pl) >= 16;
      };
      const targets = [...container.querySelectorAll('div')].filter(isInset);

      expect(targets.length).toBeGreaterThan(0);
      for (const el of targets) {
        const cs = getComputedStyle(el);
        expect(cs.paddingRight).toBe(cs.paddingLeft);
      }
    }
  );

  // THE CONTROL. Equal padding would also be satisfied by zero padding on both
  // sides, which would put the content flush against the pane's edges. The
  // inset has to survive.
  test('CONTROL: the inset is still an inset, not zero', async () => {
    const { container } = await renderWithProviders(
      <SettingsDetailsContainer />,
      {
        seedStore: (store) =>
          store.dispatch(selectCategory(SettingsCategory.LANGUAGE)),
      }
    );

    const inset = [...container.querySelectorAll('div')].filter((d) => {
      const pl = getComputedStyle(d).paddingLeft;
      return pl.includes('clamp') || parseFloat(pl) >= 16;
    });

    expect(inset.length).toBeGreaterThan(0);
  });
});
