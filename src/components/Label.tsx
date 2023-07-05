import { css } from "@emotion/react";

interface LabelProps {
  value: string;
  size?: string;
  color?: string;
  style?: string;
}

export const NormalLabel: React.FC<LabelProps> = ({
  value,
  size,
  color,
  style,
}) => {
  const textStyle = css`
    font-family: "Libre Franklin", sans-serif;
    font-size: ${size ? size : "1rem"};
    color: ${color ? color : "#808080"};
    ${style && style}
  `;

  return <div css={textStyle}>{value}</div>;
};
