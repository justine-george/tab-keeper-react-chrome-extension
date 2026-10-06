import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import { useThemeColors } from '../../../hooks/useThemeColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { TYPE } from '../../../styles/scale';

// The empty saved list's one line; page content, so it sits behind any dialog.
export default function EmptySavedList() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  return (
    <p
      data-empty-list
      css={css`
        margin: 0;
        padding: 16px;
        text-align: center;
        font-family: ${FONT_FAMILY};
        font-size: ${TYPE.BODY};
        line-height: 1.45;
        color: ${COLORS.LABEL_L1_COLOR};
      `}
    >
      {t('Saved sessions appear here.')}
    </p>
  );
}
