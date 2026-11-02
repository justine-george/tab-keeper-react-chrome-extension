// The dashed box a carried or dragged item can be let go in, shared so every
// drop target of this kind looks the same; its name is DropBoxLabel.
import { css, type SerializedStyles } from '@emotion/react';

import type { ThemeColors } from '../../hooks/useThemeColors';
import { corners } from '../../styles/corners';
import { RADIUS } from '../../styles/scale';

const EDGE_WIDTH = '1.5px';

// What a box a release would land in looks like: the press fill a session
// row under a drag takes (KAN-669), which stands off the pane in every theme
// where hover did not, and a solid edge. A drop box's edge is its own border;
// a box with no border (KAN-892, an open window) takes an outline over its
// own edge instead, so lighting it moves nothing.
export function landingLook(
  COLORS: ThemeColors,
  edge: 'border' | 'outline'
): string {
  const fill = `background-color: ${COLORS.ACTIVE_COLOR};`;
  return edge === 'border'
    ? `${fill} border-style: solid;`
    : `${fill} outline: ${EDGE_WIDTH} solid ${COLORS.LABEL_L2_COLOR}; outline-offset: -${EDGE_WIDTH};`;
}

// Dashed, then the landing look once [data-landing] is on. Where the box sits
// and how tall it is are the caller's.
export function dropBoxStyle(COLORS: ThemeColors): SerializedStyles {
  return css`
    border-width: ${EDGE_WIDTH};
    border-style: dashed;
    border-color: ${COLORS.LABEL_L2_COLOR};
    ${corners(RADIUS.PANEL)}
    &[data-landing] {
      ${landingLook(COLORS, 'border')}
    }
  `;
}
