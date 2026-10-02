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

// The knob is the pressed-state cue (the fill alone is 1.47:1 light, 1.28:1
// dark, under the 3:1 a state cue needs), so its contrast is pinned below.

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

  // The knob repeats the labels, so a screen reader must not hear it.
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

  // A pointer click anywhere flips the pair; the knob sits on the pressed
  // option.
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

  // KAN-225. To a screen reader these are two toggle buttons, so Space on the
  // pressed one must not change the other. Keyboard clicks carry `detail ===
  // 0`.
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

  // CONTROL: a keyboard that could not change the pair at all would pass the
  // test above.
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

  // The font carries the FILL axis (fetch_fonts.mjs); the browser test measures
  // the ink.
  test('the knob draws glyphs filled, the buttons draw them outlined', async () => {
    await renderUnder(Theme.LIGHT);

    // The axis is set two levels up and inherited, which jsdom does not
    // compute.
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

// From the function the component paints with; session-export.spec measures the
// render.
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

    // Text 4.5:1; state cue and glyphs (graphics) 3:1.
    expect(ratios.knobOnTrack, report).toBeGreaterThanOrEqual(3);
    expect(ratios.labelOnKnob, report).toBeGreaterThanOrEqual(4.5);
    expect(ratios.wordOnTrack, report).toBeGreaterThanOrEqual(4.5);
    expect(ratios.glyphOnTrack, report).toBeGreaterThanOrEqual(3);
  });
});
