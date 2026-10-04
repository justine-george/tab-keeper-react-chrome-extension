import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import { useThemeColors } from '../../../hooks/useThemeColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { TYPE } from '../../../styles/scale';

// KAN-7 §2 (1B). The empty detail pane says what will appear there.
export default function StartHereHint() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  return (
    <div
      data-start-here-hint
      css={css`
        display: flex;
        height: 100%;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: ${FONT_FAMILY};
        font-size: ${TYPE.BODY};
        color: ${COLORS.LABEL_L1_COLOR};
        text-align: center;
      `}
    >
      <p
        css={css`
          margin: 0;
          max-width: 28rem;
          line-height: 1.5;
        `}
      >
        {t('A saved session shows its windows and tabs here.')}
      </p>
    </div>
  );
}
