// KAN-631. A title that renames on click: a text caret, and under the pointer
// or keyboard focus a ghost of the field the click opens (PRIMARY fill, here
// 65% over the ground, and a soft edge that the field then draws dark).
import type { ThemeColors } from '../../hooks/useThemeColors';
import { DURATION } from '../../styles/scale';

// A string, as ClickableRow's `style` takes. `ground` is what the title sits
// on while hovered. The ghost reaches 6px past the text and never moves it.
export function renameOnClickStyle(
  COLORS: ThemeColors,
  ground: string
): string {
  return `
    cursor: text;
    position: relative;
    isolation: isolate;
    &::before {
      content: '';
      position: absolute;
      inset: 2px -6px;
      z-index: -1;
      border: 1px solid transparent;
      pointer-events: none;
      transition:
        background-color ${DURATION.COLOR} ease-out,
        border-color ${DURATION.COLOR} ease-out;
    }
    &:hover::before,
    &:focus-visible::before {
      background-color: color-mix(in srgb, ${COLORS.PRIMARY_COLOR} 65%, ${ground});
      border-color: ${COLORS.ICON_HOVER_COLOR};
    }
    @media (prefers-reduced-motion: reduce) {
      &::before {
        transition: none;
      }
    }
  `;
}
