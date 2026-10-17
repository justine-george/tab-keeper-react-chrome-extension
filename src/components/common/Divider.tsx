import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';

export default function Divider() {
  const COLORS = useThemeColors();

  // KAN-189: DIVIDER_COLOR, not a frame colour. The line between rows is
  // structure; drawn in Light's old near-black border (7.54:1 against the
  // pane) it read as a hard rule, and its stop at the scrollbar read as a cut.
  const containerStyle = css`
    border-bottom: 1px solid ${COLORS.DIVIDER_COLOR};
  `;

  return <div css={containerStyle}></div>;
}
