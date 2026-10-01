// The New window target's name (KAN-350 S3 A), drawn in each place the target
// is: the in-list window a carry lands in (WindowEntryContainer) and the
// session header's toolbar row (KAN-361 N1 B, HeroContainerRight). Its box is
// newWindowTargetBoxStyle's.
//
// Over the whole of that box, which must be its nearest positioned ancestor.
// Takes no pointer, so whatever the box holds is what a pointer meets.
import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Icon from '../../common/Icon';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import { TYPE } from '../../../styles/scale';

export function NewWindowTargetLabel() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  return (
    <div
      css={css`
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px;
        color: ${COLORS.LABEL_L1_COLOR};
        font-size: ${TYPE.BODY};
        pointer-events: none;
      `}
    >
      <Icon type="add_box" style={NON_INTERACTIVE_ICON_STYLE} />
      <span>{t('CarryNewWindowTarget')}</span>
    </div>
  );
}
