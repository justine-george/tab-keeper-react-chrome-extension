import { css } from '@emotion/react';

import { useThemeColors } from '../hook/useThemeColors';

interface TagProps {
  value: string;
  style?: string;
}

export const Tag: React.FC<TagProps> = ({ value, style }) => {
  const COLORS = useThemeColors();

  const tagStyle = css`
    background-color: ${COLORS.TAG_BG_COLOR};
    border: 1px solid ${COLORS.TAG_BORDER_COLOR};
    font-size: 0.7rem;
    padding: 2px 5px;
    color: ${COLORS.TEXT_COLOR};
    ${style && style}
  `;

  return <div css={tagStyle}>{value}</div>;
};
