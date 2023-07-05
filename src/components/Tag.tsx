import { css } from "@emotion/react";

interface TagProps {
  value: string;
  style?: string;
}

export const Tag: React.FC<TagProps> = ({ value, style }) => {
  const tagStyle = css`
    background-color: #d3d3d3;
    border: 1px solid #c0c0c0;
    font-size: 0.7rem;
    padding: 2px 5px;
    ${style && style}
  `;

  return <div css={tagStyle}>{value}</div>;
};
