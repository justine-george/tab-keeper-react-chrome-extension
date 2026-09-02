import React, { MouseEventHandler } from 'react';

import { css, keyframes } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';

interface IconBaseProps {
  type: string;
  faviconUrl?: string;
  disable?: boolean;
  focusable?: boolean;
  animationFrom?: string;
  animationTo?: string;
  animationDuration?: string;
  backgroundColor?: string;
  tooltipText?: string;
  text?: string;
  size?: string;
  style?: string;
}

/**
 * An Icon is either a control or a decoration, and the two are not allowed to
 * blur into each other.
 *
 * With its own onClick it renders role="button" and must be named. Without
 * one it is presentational: it is hidden from assistive tech, and it may not
 * carry an ariaLabel at all -- a bare aria-label would land on the implicit
 * `generic` role, where naming is prohibited, so assistive tech drops it while
 * a CSS attribute selector still matches. That silent gap was KAN-56, and this
 * union is what makes it a compile error rather than a thing to remember.
 *
 * When the click handler belongs on a wrapper rather than the icon, reach for
 * ClickableRow instead of labelling the icon and hoping the label surfaces.
 */
type IconProps = IconBaseProps &
  (
    | { onClick: MouseEventHandler; ariaLabel: string }
    | { onClick?: never; ariaLabel?: never }
  );

const Icon: React.FC<IconProps> = ({
  type,
  faviconUrl,
  onClick,
  disable,
  focusable = true,
  animationFrom,
  animationTo,
  animationDuration,
  backgroundColor,
  ariaLabel,
  tooltipText,
  text,
  size = '1.5rem',
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
    font-size: ${size};
    width: ${size};
    height: ${size};
    object-fit: contain;
    color: ${COLORS.TEXT_COLOR};
    ${hoverAnimation}
  `;

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 4px;
    cursor: ${focusable ? 'pointer' : 'default'};
    user-select: none;
    transition: background-color 0.2s;
    background-color: ${backgroundColor};
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
      title={tooltipText}
      aria-label={ariaLabel}
      // Presentational icons are hidden outright rather than merely unnamed.
      // The glyph renders as ligature text ("arrow_back", "add_box"), which
      // would otherwise leak into the accessible name of whatever button
      // contains it -- Button's inner Icon is exactly that case.
      aria-hidden={onClick ? undefined : true}
      tabIndex={onClick && focusable ? 0 : -1}
      css={containerStyle}
      onClick={!disable ? onClick : undefined}
      onKeyDown={(e) => handleKeyPress(e)}
      role={onClick ? 'button' : undefined}
    >
      {faviconUrl ? (
        <img src={faviconUrl} alt="favicon" css={iconStyle} />
      ) : (
        <div
          css={css`
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          `}
        >
          <span css={iconStyle} className="material-symbols-outlined">
            {type}
          </span>
          {text && (
            <p
              css={css`
                margin: 0;
                color: ${COLORS.TEXT_COLOR};
              `}
            >
              {text}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default Icon;
