import React from 'react';

import Button from '../../common/Button';
import { useTranslation } from 'react-i18next';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { CONTROL, DURATION, TYPE } from '../../../styles/scale';

interface RowOpenButtonProps {
  ariaLabel: string;
  tooltipText: string;
  onClick: () => void;
  // KAN-413. Dimmed as Undo is, announced as unavailable, and a click does nothing.
  disable?: boolean;
}

// The label steps up to TEXT on hover and press: LABEL_L1 is under 4.5:1 there.
const RowOpenButton: React.FC<RowOpenButtonProps> = ({
  ariaLabel,
  tooltipText,
  onClick,
  disable,
}) => {
  const { t } = useTranslation();
  const COLORS = useThemeColors();

  return (
    <Button
      variant="outline"
      iconType="reopen_window"
      text={t('Open')}
      ariaLabel={ariaLabel}
      tooltipText={tooltipText}
      onClick={onClick}
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

export default RowOpenButton;
