import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';

export default function Divider() {
  const COLORS = useThemeColors();

  const containerStyle = css`
    border-bottom: 1px solid ${COLORS.BORDER_COLOR};
  `;

  return <div css={containerStyle}></div>;
}
