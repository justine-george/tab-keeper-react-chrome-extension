import { MouseEventHandler } from 'react';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { tooltipDescription } from './tooltipRules';

interface LabelProps {
  value?: string;
  size?: string;
  color?: string;
  style?: string;
  tooltipText?: string;
  onClick?: MouseEventHandler;
  // A long value goes onto more lines instead of ending in an ellipsis.
  wraps?: boolean;
}

export const NormalLabel: React.FC<LabelProps> = ({
  value,
  size,
  color,
  style,
  tooltipText,
  onClick,
  wraps = false,
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
    white-space: ${wraps ? 'normal' : 'nowrap'};
    ${style && style}
  `;

  // The wrapper stays a flex container so callers can keep centring it and
  // passing height: 100%. text-overflow does not apply to flex containers, so
  // the ellipsis has to live on an inner box.
  const truncateStyle = css`
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  `;
  const wrapStyle = css`
    min-width: 0;
    overflow-wrap: break-word;
  `;

  return (
    <div
      data-tooltip={tooltipText}
      aria-description={tooltipDescription(tooltipText, value)}
      css={textStyle}
      onClick={onClick}
    >
      <span css={wraps ? wrapStyle : truncateStyle}>{value}</span>
    </div>
  );
};
