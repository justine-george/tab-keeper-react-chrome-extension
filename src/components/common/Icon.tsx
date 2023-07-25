import React, { MouseEventHandler } from "react";
import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";

interface IconProps {
  type: string;
  onClick?: MouseEventHandler;
  style?: string;
}

const Icon: React.FC<IconProps> = ({ type, onClick, style }) => {
  const COLORS = useThemeColors();

  const iconStyle = css`
    font-size: 1.5rem;
    color: ${COLORS.TEXT_COLOR};
  `;

  const hoverColor =
    type === "delete"
      ? COLORS.DELETE_ICON_HOVER_COLOR
      : COLORS.ICON_HOVER_COLOR;

  const containerStyle = css`
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 4px;
    cursor: pointer;
    user-select: none;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${hoverColor};
    }
    ${style && style}
  `;

  return (
    <div css={containerStyle} onClick={onClick}>
      <span css={iconStyle} className="material-symbols-outlined">
        {type}
      </span>
    </div>
  );
};

export default Icon;
