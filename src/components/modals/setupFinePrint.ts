import type { ThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../styles/scale';
import { focusRingOutsideCss } from '../common/focusRing';

// Setup's small print, without its margin: the import step's line wears it too, so the two read as one voice.
export function setupFinePrintCss(COLORS: ThemeColors): string {
  return `
    font-size: ${TYPE.SECONDARY};
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
    a {
      color: ${COLORS.TEXT_COLOR};
      ${focusRingOutsideCss(COLORS)}
    }
    /* Korean wraps mid-word otherwise; ja and zh have no spaces to break at. */
    &:lang(ko) {
      word-break: keep-all;
    }
  `;
}
