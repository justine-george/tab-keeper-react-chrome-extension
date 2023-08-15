import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";
import { MouseEventHandler } from "react";

interface LabelProps {
  value: string;
  size?: string;
  color?: string;
  style?: string;
  onClick?: MouseEventHandler;
}

export const NormalLabel: React.FC<LabelProps> = ({
  value,
  size,
  color,
  style,
  onClick,
}) => {
  const COLORS = useThemeColors();

  const textStyle = css`
    display: flex;
    align-items: center;
    font-family: "Libre Franklin", sans-serif;
    font-size: ${size ? size : "1rem"};
    color: ${color ? color : COLORS.LABEL_L3_COLOR};
    overflow: hidden;
    white-space: nowrap;
    // text-overflow: ellipsis;
    ${style && style}
  `;

  return (
    <div css={textStyle} onClick={onClick}>
      {value}
    </div>
  );
};
