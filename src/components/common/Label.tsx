import { MouseEventHandler } from 'react';

import { css } from '@emotion/react';

import { useFontFamily } from '../hook/useFontFamily';
import { useThemeColors } from '../hook/useThemeColors';

interface LabelProps {
  value?: string;
  size?: string;
  color?: string;
  style?: string;
  tooltipText?: string;
  onClick?: MouseEventHandler;
}

export const NormalLabel: React.FC<LabelProps> = ({
  value,
  size,
  color,
  style,
  tooltipText,
  onClick,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  const textStyle = css`
    display: flex;
    align-items: center;
    font-family: ${FONT_FAMILY};
    font-size: ${size ? size : '1rem'};
    color: ${color ? color : COLORS.LABEL_L3_COLOR};
    overflow: hidden;
    white-space: nowrap;
    ${style && style}
  `;

  return (
    <div title={tooltipText} css={textStyle} onClick={onClick}>
      {value}
    </div>
  );
};
