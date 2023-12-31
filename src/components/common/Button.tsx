import React from 'react';

import { css } from '@emotion/react';

import Icon from './Icon';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';

interface ButtonProps {
  text?: string;
  onClick?: () => void;
  imageSrc?: string;
  iconType?: string;
  ariaLabel?: string;
  tooltipText?: string;
  iconSize?: string;
  iconStyle?: string;
  focusableButton?: boolean;
  style?: string;
}

const Button: React.FC<ButtonProps> = ({
  text,
  onClick,
  imageSrc,
  iconType,
  ariaLabel,
  tooltipText,
  iconSize,
  iconStyle,
  focusableButton,
  style,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  const buttonStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    padding: 10px 20px;
    height: 3.5rem;
    display: flex;
    align-items: center;
    justify-content: space-around;
    font-family: ${FONT_FAMILY};
    font-size: 0.9rem;
    cursor: pointer;
    transition: background-color 0.2s;
    color: ${COLORS.TEXT_COLOR};
    &:hover {
      background-color: ${COLORS.ICON_HOVER_COLOR};
    }
    ${style && style}
  `;

  iconStyle;

  return (
    <div>
      <button
        title={tooltipText}
        aria-label={ariaLabel}
        css={buttonStyle}
        onClick={onClick}
        tabIndex={onClick && focusableButton ? 0 : -1}
      >
        {iconType && (
          <Icon
            type={iconType}
            disable={true}
            focusable={true}
            size={iconSize}
            style={(imageSrc || text) && 'padding-right: 8px;' && iconStyle}
          />
        )}
        {imageSrc && (
          <img
            src={imageSrc}
            alt="icon"
            css={css`
              width: 30px;
              height: 30px;
              object-fit: contain;
            `}
          />
        )}
        {text && (
          <span
            css={css`
              ${imageSrc && 'padding-left: 8px;'}
            `}
          >
            {text}
          </span>
        )}
      </button>
    </div>
  );
};

export default Button;
