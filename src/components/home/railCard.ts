import { css } from '@emotion/react';

import type { ThemeColors } from '../../hooks/useThemeColors';
import { corners } from '../../styles/corners';
import { RADIUS } from '../../styles/scale';
import { RAIL_CARD_PX } from './opennow/railQuery';

// KAN-999 (his picks E2 and round 4). A rail is an outlined card: the session
// list's border and corners, no fill, its glyph and label at the top. Its
// box runs the height its holder gives it.
export const railCardStyle = (COLORS: ThemeColors) => css`
  box-sizing: border-box;
  width: ${RAIL_CARD_PX}px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 4px;
  overflow: hidden;
  border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
  ${corners(RADIUS.PANEL)}
`;
