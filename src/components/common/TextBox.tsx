import React from "react";
import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";

interface TextBoxProps {
  id: string;
  name: string;
  placeholder: string;
  autoComplete: string;
  style?: string;
}

const TextBox: React.FC<TextBoxProps> = ({
  id,
  name,
  placeholder,
  autoComplete,
  style,
}) => {
  const COLORS = useThemeColors();

  const textInputStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    padding: 10px;
    height: 3.5rem;
    flex-grow: 1;
    font-family: "Libre Franklin", sans-serif;
    font-size: 0.9rem;
    &:focus {
      outline: none;
    }
    ${style && style}
  `;

  return (
    <input
      type="text"
      id={id}
      name={name}
      placeholder={placeholder}
      autoComplete={autoComplete}
      css={textInputStyle}
    />
  );
};

export default TextBox;
