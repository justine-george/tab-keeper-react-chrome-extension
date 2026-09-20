import type { ThemeColors } from '../../hooks/useThemeColors';

/**
 * The colours a pair paints with, from a page palette (KAN-218).
 *
 * One function, so the component and exportSlidingPair.test.tsx cannot
 * disagree about what is measured. The knob is the state cue, replacing
 * KAN-199's line: TEXT on PRIMARY is 10.15:1 light and 9.31:1 dark against
 * the 3:1 a state cue needs. Unpressed glyphs go quieter than words, because a
 * glyph is a graphic (3:1) and a word is text (4.5:1).
 */
export function slidingPairColors(palette: ThemeColors) {
  return {
    // The buttons' own fill (Justine), so the pair reads as one more control on
    // the toolbar rather than a recess in it.
    track: palette.PRIMARY_COLOR,
    knob: palette.TEXT_COLOR,
    labelOnKnob: palette.PRIMARY_COLOR,
    word: palette.TEXT_COLOR,
    glyph: palette.LABEL_L2_COLOR,
  };
}
