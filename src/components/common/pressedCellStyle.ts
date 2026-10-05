import type { ThemeColors } from '../../hooks/useThemeColors';
import { slidingPairColors } from './slidingPairColors';

// KAN-420. The SlidingPair knob's look for a pressed language cell, shared by
// setup and Settings so the two cannot drift; the cell adds its own check.
export function pressedCellStyle(palette: ThemeColors): string {
  const { knob, labelOnKnob } = slidingPairColors(palette);
  return `
    background-color: ${knob};
    border-color: ${knob};
    color: ${labelOnKnob};
    &:hover,
    &:active {
      background-color: ${knob};
    }
  `;
}
