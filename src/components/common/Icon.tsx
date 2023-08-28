import React, { MouseEventHandler } from 'react';
import { css, keyframes } from '@emotion/react';
import { useThemeColors } from '../hook/useThemeColors';

interface IconProps {
  type: string;
  faviconUrl?: string;
  onClick?: MouseEventHandler;
  disable?: boolean;
  focusable?: boolean;
  animationFrom?: string;
  animationTo?: string;
  animationDuration?: string;
  style?: string;
}

const Icon: React.FC<IconProps> = ({
  type,
  faviconUrl,
  onClick,
  disable,
  focusable = true,
  animationFrom,
  animationTo,
  animationDuration,
  style,
}) => {
  const COLORS = useThemeColors();

  function handleKeyPress(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && onClick) {
      onClick(e as any);
    }
  }

  // Define keyframe animation
  const hoverAnimation =
    animationFrom &&
    animationTo &&
    css`
      &:hover {
        animation: ${keyframes`
      from {
        ${animationFrom}
      }
      to {
        ${animationTo}
      }
    `} ${animationDuration ? animationDuration : `0.25s`} linear 1;
      }
    `;

  const hoverColor =
    type === 'delete'
      ? COLORS.DELETE_ICON_HOVER_COLOR
      : COLORS.ICON_HOVER_COLOR;

  const iconStyle = css`
    font-size: 1.5rem;
    width: 1.5rem;
    height: 1.5rem;
    object-fit: contain;
    color: ${COLORS.TEXT_COLOR};
    ${hoverAnimation}
  `;

  const containerStyle = css`
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 4px;
    cursor: ${focusable ? 'pointer' : 'default'};
    user-select: none;
    transition: background-color 0.3s;
    ${focusable &&
    `&:hover {
      background-color: ${hoverColor};
    }`}
    ${style && style}
  `;

  return (
    // tab-focus only if the icon is clickable
    // set role as button for accessibility
    <div
      tabIndex={onClick && focusable ? 0 : -1}
      css={containerStyle}
      onClick={!disable ? onClick : undefined}
      onKeyDown={(e) => handleKeyPress(e)}
      role={onClick ? 'button' : undefined}
    >
      {faviconUrl ? (
        <img src={faviconUrl} alt="favicon" css={iconStyle} />
      ) : (
        <span css={iconStyle} className="material-symbols-outlined">
          {type}
        </span>
      )}
    </div>
  );
};

export default Icon;
