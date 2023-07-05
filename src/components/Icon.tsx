import React from "react";
import { css } from "@emotion/react";

interface IconProps {
  type: string;
  style?: string;
}

const Icon: React.FC<IconProps> = ({ type, style }) => {
  const iconStyle = css`
    font-size: 1.5rem;
  `;

  const containerStyle = css`
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 5px;
    cursor: pointer;
    user-select: none;
    ${style && style}
  `;

  return (
    <div css={containerStyle}>
      <span css={iconStyle} className="material-symbols-outlined">
        {type}
      </span>
    </div>
  );
};

export default Icon;
