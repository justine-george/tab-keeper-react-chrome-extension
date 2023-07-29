import React, { MouseEventHandler } from "react";
import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";

interface IconProps {
  type: string;
  faviconUrl?: string;
  onClick?: MouseEventHandler;
  style?: string;
}

const Icon: React.FC<IconProps> = ({ type, faviconUrl, onClick, style }) => {
  const COLORS = useThemeColors();

  const iconStyle = css`
    font-size: 1.5rem;
    width: 1.5rem;
    height: 1.5rem;
    object-fit: contain;
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

  function handleKeyPress(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && onClick) {
      onClick(e as any);
    }
  }

  return (
    // tab-focus only if the icon is clickable
    // set role as button for accessibility
    <div
      tabIndex={onClick ? 0 : -1}
      css={containerStyle}
      onKeyDown={(e) => handleKeyPress(e)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
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
