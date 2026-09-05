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
  // KAN-88. Marks a button that toggles something, and says which way it is
  // currently set. Left undefined on ordinary buttons, where React omits the
  // attribute entirely -- an aria-pressed="false" on a button that does not
  // toggle would announce it as an unpressed toggle, which is worse than
  // silence.
  ariaPressed?: boolean;
  tooltipText?: string;
  iconSize?: string;
  iconStyle?: string;
  style?: string;
}

const Button: React.FC<ButtonProps> = ({
  text,
  onClick,
  imageSrc,
  iconType,
  ariaLabel,
  ariaPressed,
  tooltipText,
  iconSize,
  iconStyle,
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

  // Space the icon away from whatever sits next to it, but only when there is
  // something next to it -- on an icon-only button the padding would just be a
  // bare asymmetry.
  //
  // iconStyle goes last so a caller's own padding wins. The single caller that
  // passes it (HeroContainerRight's "Add window") sends the shorthand
  // `padding: 4px 4px 2px 4px`, which is meant to override this outright.
  // Reversing the order would silently restyle that button.
  const iconSpacing = [
    imageSrc || text ? 'padding-right: 8px;' : '',
    iconStyle ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  // No wrapper element: the button must be the flex child itself, otherwise a
  // width: 100% passed through `style` resolves against a shrink-wrapped div
  // and collapses back to the button's own text width.
  //
  // Deliberately no tabIndex. A <button> is keyboard-focusable by default, so
  // the only thing this element could ever compute here is a way to LOSE that
  // -- which is precisely what it used to do. `focusableButton` had no default
  // value, so `tabIndex={onClick && focusableButton ? 0 : -1}` put 32 of the
  // 36 clickable call sites out of the tab order, taking the whole settings
  // pane with them (KAN-67). The prop is gone rather than defaulted to true:
  // a prop whose only power is to break something breaks it the moment a call
  // site forgets, and 32 of 36 forgot.
  return (
    <button
      title={tooltipText}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      css={buttonStyle}
      onClick={onClick}
    >
      {iconType && (
        <Icon
          type={iconType}
          disable={true}
          size={iconSize}
          style={iconSpacing}
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
  );
};

export default Button;
