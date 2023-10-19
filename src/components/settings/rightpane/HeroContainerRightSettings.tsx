import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import { useTranslation } from 'react-i18next';

export default function HeroContainerRightSettings() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const containerStyle = css`
    display: flex;
    flex-direction: row;
    align-items: center;
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    user-select: none;
    background-color: ${COLORS.SECONDARY_COLOR};
    padding: 8px 8px;
  `;

  return (
    <div css={containerStyle}>
      <Icon type="settings" style={NON_INTERACTIVE_ICON_STYLE} />
      <NormalLabel
        value={t('Settings')}
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
        style="padding-left: 4px;"
      />
    </div>
  );
}
