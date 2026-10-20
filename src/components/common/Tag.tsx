import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../styles/scale';

interface TagProps {
  value: string;
  style?: string;
  // KAN-720. data-* hooks (RowTag's) reach the div.
  [dataAttribute: `data-${string}`]: string | undefined;
}

export const Tag: React.FC<TagProps> = ({
  value,
  style,
  ...dataAttributes
}) => {
  const COLORS = useThemeColors();

  const tagStyle = css`
    background-color: ${COLORS.TAG_BG_COLOR};
    border: 1px solid ${COLORS.TAG_BORDER_COLOR};
    font-size: ${TYPE.META};
    padding: 2px 5px;
    color: ${COLORS.TEXT_COLOR};
    ${style && style}
  `;

  return (
    <div css={tagStyle} {...dataAttributes}>
      {value}
    </div>
  );
};
