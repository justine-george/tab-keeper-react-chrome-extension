import React from 'react';

import RowTextButton from '../../common/RowTextButton';
import { useTranslation } from 'react-i18next';

interface RowOpenButtonProps {
  ariaLabel: string;
  tooltipText: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  // KAN-885. A middle-click.
  onAuxClick?: React.MouseEventHandler<HTMLButtonElement>;
  // KAN-413. Dimmed as Undo is, announced as unavailable, and a click does nothing.
  disable?: boolean;
}

const RowOpenButton: React.FC<RowOpenButtonProps> = (props) => {
  const { t } = useTranslation();

  return <RowTextButton iconType="reopen_window" text={t('Open')} {...props} />;
};

export default RowOpenButton;
