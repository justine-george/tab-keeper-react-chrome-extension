import React from "react";
import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";

interface TextBoxProps {
  id: string;
  name: string;
  value: string;
  placeholder: string;
  autoComplete: string;
  onChange: Function;
  style?: string;
}

const TextBox: React.FC<TextBoxProps> = ({
  id,
  name,
  value,
  placeholder,
  autoComplete,
  onChange,
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
    color: ${COLORS.LABEL_L3_COLOR};
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
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      css={textInputStyle}
      onChange={(e) => onChange(e)}
    />
  );
};

export default TextBox;
