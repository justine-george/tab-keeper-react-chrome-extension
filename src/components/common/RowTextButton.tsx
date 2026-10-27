import React from 'react';

import Button from './Button';
import { onFirstClickOnly } from './firstClickOnly';
import type { IconName } from './iconNames';
import { useThemeColors } from '../../hooks/useThemeColors';
import { CONTROL, DURATION, TYPE } from '../../styles/scale';

interface RowTextButtonProps {
  iconType: IconName;
  text: string;
  ariaLabel: string;
  tooltipText: string;
  onClick: () => void;
  // KAN-413. Dimmed as Undo is, announced as unavailable, and a click does nothing.
  disable?: boolean;
}

// A row's text button (KAN-394 D11, KAN-696): Open on a saved row, Save on a live one.
// A double-click is one press (KAN-698): it opens or saves once.
// The label steps up to TEXT on hover and press: LABEL_L1 is under 4.5:1 there.
const RowTextButton: React.FC<RowTextButtonProps> = ({
  iconType,
  text,
  ariaLabel,
  tooltipText,
  onClick,
  disable,
}) => {
  const COLORS = useThemeColors();

  return (
    <Button
      variant="outline"
      iconType={iconType}
      text={text}
      ariaLabel={ariaLabel}
      tooltipText={tooltipText}
      onClick={onFirstClickOnly(onClick)}
      ariaDisabled={disable}
      style={`
        height: ${CONTROL.ROW};
        padding: 0 10px;
        font-size: ${TYPE.SECONDARY};
        color: ${COLORS.LABEL_L1_COLOR};
        transition: background-color ${DURATION.COLOR}, color ${DURATION.COLOR};
        &:hover,
        &:active {
          color: ${COLORS.TEXT_COLOR};
        }
        ${disable ? 'opacity: 0.3;' : ''}
      `}
    />
  );
};

export default RowTextButton;
