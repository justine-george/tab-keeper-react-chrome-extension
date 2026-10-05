import type { ThemeColors } from '../../hooks/useThemeColors';
import { slidingPairColors } from './slidingPairColors';

// The SlidingPair knob's look for a pressed cell, shared so setup and Settings cannot drift.
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
