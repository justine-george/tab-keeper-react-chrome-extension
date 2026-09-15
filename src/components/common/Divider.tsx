import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';

export default function Divider() {
  const COLORS = useThemeColors();

  // KAN-189: DIVIDER_COLOR, not BORDER_COLOR. The line between rows is
  // structure, and on Light BORDER_COLOR is near-black (7.54:1 against the
  // pane), so it read as a hard rule and its stop at the scrollbar read as a
  // cut. BORDER_COLOR stays as it is for pane borders, inputs and buttons.
  const containerStyle = css`
    border-bottom: 1px solid ${COLORS.DIVIDER_COLOR};
  `;

  return <div css={containerStyle}></div>;
}
