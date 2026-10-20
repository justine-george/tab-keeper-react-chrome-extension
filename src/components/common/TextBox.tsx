import React from 'react';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { CONTROL, TYPE } from '../../styles/scale';
import { placeholderStyle } from '../../styles/placeholder';
import { fieldRingCss } from './focusRing';

interface TextBoxProps {
  id: string;
  name: string;
  value: string;
  type?: string;
  placeholder: string;
  autoComplete?: string;
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
  onChange,
  onKeyEnter,
  style,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
    if (onKeyEnter && e.key === 'Enter') {
      onKeyEnter();
      // As a click on the save button leaves the field (KAN-679).
      e.currentTarget.blur();
    } else if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      // Chrome closes the popup on an Esc left alone (KAN-678). The name stays;
      // an IME's Esc cancels its word and stays the IME's.
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  const textInputStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.CONTROL_BORDER_COLOR};
    padding: 10px;
    height: ${CONTROL.DEFAULT};
    flex-grow: 1;
    min-width: 0;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    color: ${COLORS.LABEL_L1_COLOR};
    ${placeholderStyle(COLORS.PLACEHOLDER_COLOR)}
    ${fieldRingCss(COLORS)}
    ${style && style}
  `;

  return (
    <input
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
