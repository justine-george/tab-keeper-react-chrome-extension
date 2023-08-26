import React from "react";
import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";
import Icon from "./Icon";

interface ButtonProps {
  text?: string;
  onClick?: () => void;
  imageSrc?: string;
  iconType?: string;
  style?: string;
}

const Button: React.FC<ButtonProps> = ({
  text,
  onClick,
  imageSrc,
  iconType,
  style,
}) => {
  const COLORS = useThemeColors();

  const buttonStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    padding: 10px 20px;
    height: 3.5rem;
    display: flex;
    align-items: center;
    justify-content: space-around;
    font-family: "Libre Franklin", sans-serif;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background-color 0.3s;
    color: ${COLORS.TEXT_COLOR};
    &:hover {
      background-color: ${COLORS.ICON_HOVER_COLOR};
    }
    ${style && style}
  `;

  return (
    <div>
      <button css={buttonStyle} onClick={onClick}>
        {iconType && (
          <Icon
            type={iconType}
            disable={true}
            focusable={true}
            style="padding-right: 8px;"
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
              ${imageSrc && "padding-left: 8px;"}
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
