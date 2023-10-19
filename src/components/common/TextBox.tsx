import React from 'react';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';

interface TextBoxProps {
  id: string;
  name: string;
  value: string;
  type?: string;
  placeholder: string;
  autoComplete?: string;
  title?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyEnter?: () => void;
  style?: string;
}

const TextBox: React.FC<TextBoxProps> = ({
  id,
  name,
  value,
  type,
  placeholder,
  autoComplete,
  title,
  onChange,
  onKeyEnter,
  style,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
    if (onKeyEnter && e.key === 'Enter') {
      onKeyEnter();
    }
  }

  const textInputStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    padding: 10px;
    height: 3.5rem;
    flex-grow: 1;
    font-family: ${FONT_FAMILY};
    font-size: 0.9rem;
    color: ${COLORS.LABEL_L1_COLOR};
    &::placeholder {
      color: ${COLORS.LABEL_L3_COLOR};
    }
    &:focus {
      outline: none;
    }
    ${style && style}
  `;

  return (
    <input
      title={title}
      type={type ? type : 'text'}
      id={id}
      name={name}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onKeyDown={(e) => handleKeyPress(e)}
      onChange={(e) => onChange(e)}
      css={textInputStyle}
    />
  );
};

export default TextBox;
