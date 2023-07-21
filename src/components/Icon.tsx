import React from "react";
import { css } from "@emotion/react";
import { GLOBAL } from "../utils/constants";

interface IconProps {
  type: string;
  onClick?: () => void;
  style?: string;
}

const Icon: React.FC<IconProps> = ({ type, onClick, style }) => {
  const iconStyle = css`
    font-size: 1.5rem;
  `;

  const hoverColor =
    type === "delete"
      ? GLOBAL.DELETE_ICON_HOVER_COLOR
      : GLOBAL.ICON_HOVER_COLOR;

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
