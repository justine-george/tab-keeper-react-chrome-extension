// The dashed box a carried or dragged item can be let go in, shared so every
// drop target of this kind looks the same; its name is DropBoxLabel.
import { css, type SerializedStyles } from '@emotion/react';

import type { ThemeColors } from '../../hooks/useThemeColors';
import { RADIUS } from '../../styles/scale';

// Dashed, then the hover fill and a solid border once [data-landing] is on.
// Where the box sits and how tall it is are the caller's.
export function dropBoxStyle(COLORS: ThemeColors): SerializedStyles {
  return css`
    border-width: 1.5px;
    border-style: dashed;
    border-color: ${COLORS.LABEL_L2_COLOR};
    border-radius: ${RADIUS.SQUARE};
    &[data-landing] {
      background-color: ${COLORS.HOVER_COLOR};
      border-style: solid;
    }
  `;
}
