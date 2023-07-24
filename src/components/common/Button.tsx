import React from "react";
import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";

interface ButtonProps {
  text: string;
  onClick?: () => void;
  style?: string;
}

const Button: React.FC<ButtonProps> = ({ text, onClick, style }) => {
  const COLORS = useThemeColors();

  const buttonStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    padding: 10px 20px;
    height: 3.5rem;
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
        {text}
      </button>
    </div>
  );
};

export default Button;
