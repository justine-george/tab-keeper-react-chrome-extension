import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { slidingPairColors } from '../../components/common/slidingPairColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';
import { DARKENHEIMER_THEME, LIGHT_THEME } from '../../hooks/useThemeColors';
import { contrast } from '../setup/contrast';

// KAN-218. The export toolbar's two pairs -- Layout and Colour -- were
// segments marked by a line along the bottom of the pressed one (KAN-199).
// Justine asked for the line to go and for something more playful. Each pair
// is now a track with a knob that slides under the pressed option.
//
// What KAN-199 was protecting still holds: the fill alone said which segment
// was pressed at 1.47:1 light and 1.28:1 dark, below the 3:1 a state cue
// needs. The knob replaces the line as that cue, so its contrast is pinned
// below exactly as the line's was.

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

const group = (name: string) => screen.getByRole('group', { name });

const pressed = (name: string) =>
  within(group(name))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('aria-label'));

const knobOf = (name: string) => {
  const knob = group(name).querySelector('[data-sliding-knob]');
  if (!knob) throw new Error(`the ${name} pair has no knob`);
  return knob;
};

describe('each pair is a sliding knob (KAN-218)', () => {
  test('no segment draws the KAN-199 line any more', async () => {
    await renderUnder(Theme.LIGHT);

    for (const name of ['Layout', 'Colour']) {
      for (const button of within(group(name)).getAllByRole('button')) {
        const shadow = getComputedStyle(button).boxShadow;
        expect(
          shadow === '' || shadow === 'none',
          `${button.getAttribute('aria-label')} draws "${shadow}"`
        ).toBe(true);
      }
    }
  });

  // The knob repeats the labels, so it must not repeat them to a screen
  // reader: each pair still announces exactly two buttons.
  test('each pair has one knob, hidden from assistive tech', async () => {
    await renderUnder(Theme.LIGHT);

    for (const name of ['Layout', 'Colour']) {
      expect(
        group(name).querySelectorAll('[data-sliding-knob]'),
        `${name} knobs`
      ).toHaveLength(1);
      expect(knobOf(name).getAttribute('aria-hidden')).toBe('true');
      expect(within(group(name)).getAllByRole('button')).toHaveLength(2);
    }
  });

  test('the knob sits under the pressed option', async () => {
    await renderUnder(Theme.LIGHT);

    expect(pressed('Layout')).toEqual(['Compact']);
    expect(knobOf('Layout').getAttribute('data-sliding-knob')).toBe('compact');
    expect(knobOf('Colour').getAttribute('data-sliding-knob')).toBe('light');
  });

  test('pressing the other option moves the knob to it', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(pressed('Colour')).toEqual(['Dark']);
    expect(knobOf('Colour').getAttribute('data-sliding-knob')).toBe('dark');
  });

  // Justine: the pair is a toggle, so a click anywhere on it -- the knob
  // included -- flips it. Clicking the pressed option is the click on the knob.
  test('pressing the pressed option flips the pair', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);
    const frame = () => document.querySelector('iframe')!.srcdoc;
    await waitFor(() => expect(frame()).not.toBe(''));
    const compactFile = frame();

    await user.click(screen.getByRole('button', { name: 'Compact' }));

    expect(pressed('Layout')).toEqual(['Comfortable']);
    expect(knobOf('Layout').getAttribute('data-sliding-knob')).toBe(
      'comfortable'
    );
    // CONTROL: the flip reached the file, not only the buttons.
    await waitFor(() => expect(frame()).not.toBe(compactFile));
  });

  // KAN-225. The pointer flip above is a toggle; to a screen reader the pair
  // is two toggle buttons. Focusing "Compact, toggle button, pressed" and
  // pressing Space must not select Comfortable -- that is an action on one
  // control changing another, announced as nothing at all. So keyboard
  // activation of the PRESSED option does nothing, the ordinary segmented
  // control contract, while the pointer keeps its flip. The browser tells
  // the two apart: a keyboard or assistive click carries `detail === 0`, a
  // pointer click its click count.
  test('keyboard activation of the pressed option leaves it pressed', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);
    expect(pressed('Layout')).toEqual(['Compact']);

    const compact = screen.getByRole('button', { name: 'Compact' });
    compact.focus();
    await user.keyboard(' ');
    expect(pressed('Layout')).toEqual(['Compact']);
    await user.keyboard('{Enter}');
    expect(pressed('Layout')).toEqual(['Compact']);
    expect(knobOf('Layout').getAttribute('data-sliding-knob')).toBe('compact');
  });

  // CONTROL: the keyboard still SELECTS. Only the no-op on an already-pressed
  // option is new; a keyboard that could not change the pair at all would
  // pass the test above.
  test('CONTROL: keyboard activation of the other option selects it', async () => {
    const user = userEvent.setup();
    await renderUnder(Theme.LIGHT);

    screen.getByRole('button', { name: 'Comfortable' }).focus();
    await user.keyboard(' ');

    expect(pressed('Layout')).toEqual(['Comfortable']);
  });

  test('a dark page starts with the knob under Dark', async () => {
    await renderUnder(Theme.DARKENHEIMER);

    expect(pressed('Colour')).toEqual(['Dark']);
    expect(knobOf('Colour').getAttribute('data-sliding-knob')).toBe('dark');
  });

  // The knob's copy of a glyph is filled; the button's own is outlined. The
  // font carries the FILL axis for this (fetch_fonts.mjs); the browser test
  // measures the ink.
  test('the knob draws glyphs filled, the buttons draw them outlined', async () => {
    await renderUnder(Theme.LIGHT);

    // Icon puts a caller's style on its outer box, two levels above the glyph,
    // and the axis inherits from there; jsdom does not compute inheritance, so
    // this walks up to the root it was given.
    const fillOf = (glyph: Element, root: Element) => {
      for (
        let el: Element | null = glyph;
        el && el !== root;
        el = el.parentElement
      ) {
        const declared = getComputedStyle(el).fontVariationSettings;
        if (declared) return declared;
      }
      return '';
    };
    const glyphsIn = (root: Element) => [
      ...root.querySelectorAll('.material-symbols-outlined'),
    ];

    const knobGlyphs = glyphsIn(knobOf('Colour'));
    expect(knobGlyphs).toHaveLength(2);
    for (const glyph of knobGlyphs) {
      expect(fillOf(glyph, knobOf('Colour'))).toContain("'FILL' 1");
    }
    for (const button of within(group('Colour')).getAllByRole('button')) {
      for (const glyph of glyphsIn(button)) {
        expect(fillOf(glyph, button)).not.toContain("'FILL' 1");
      }
    }
  });
});

// The numbers the knob exists for, from the same function the component paints
// with. The rendered colours are measured again in session-export.spec.
describe('the knob reads on both page palettes (KAN-218)', () => {
  test.each([
    ['light', LIGHT_THEME],
    ['dark', DARKENHEIMER_THEME],
  ])('on a %s page', (_, palette) => {
    const c = slidingPairColors(palette);
    const ratios = {
      knobOnTrack: contrast(c.knob, c.track),
      labelOnKnob: contrast(c.labelOnKnob, c.knob),
      wordOnTrack: contrast(c.word, c.track),
      glyphOnTrack: contrast(c.glyph, c.track),
    };
    const report = JSON.stringify(ratios, (_, v) =>
      typeof v === 'number' ? Number(v.toFixed(2)) : v
    );

    // The state cue itself: 3:1, as KAN-199's line had to clear.
    expect(ratios.knobOnTrack, report).toBeGreaterThanOrEqual(3);
    // Words are text, so 4.5:1 wherever they sit.
    expect(ratios.labelOnKnob, report).toBeGreaterThanOrEqual(4.5);
    expect(ratios.wordOnTrack, report).toBeGreaterThanOrEqual(4.5);
    // Glyphs are graphics: 3:1.
    expect(ratios.glyphOnTrack, report).toBeGreaterThanOrEqual(3);
  });
});
