import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";

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
  const COLORS = useThemeColors();

  const textStyle = css`
    font-family: "Libre Franklin", sans-serif;
    font-size: ${size ? size : "1rem"};
    color: ${color ? color : COLORS.LABEL_L3_COLOR};
    ${style && style}
  `;

  return <div css={textStyle}>{value}</div>;
};
