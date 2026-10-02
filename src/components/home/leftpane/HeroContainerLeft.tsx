import { css } from '@emotion/react';

import MenuContainer from './MenuContainer';
import { NormalLabel } from '../../common/Label';
import TabKeeperMark from '../../common/TabKeeperMark';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from 'react-i18next';
import { ICON, TYPE } from '../../../styles/scale';

export default function HeroContainer() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.TITLE};
    /* No fixed height: a pane header is not a control, it is content
       plus padding, and giving it a control height is what put 32px of
       icons inside a 64px box with half of it empty.

       12px against the pane's 8px sides. 8px was tried and read as
       tight; 16px is what it was, and that is the floating look. */
    padding: 12px 0px;
    user-select: none;
  `;

  return (
    <div css={containerStyle}>
      {/* min-width: 0 lets the title give way to the icons (KAN-343). */}
      <div
        css={css`
          min-width: 0;
          display: flex;
          align-items: center;
        `}
      >
        <div
          css={css`
            width: calc(${ICON.DEFAULT} + 8px);
            height: calc(${ICON.DEFAULT} + 8px);
            display: flex;
            align-items: center;
            justify-content: center;
            flex: none;
          `}
        >
          <TabKeeperMark />
        </div>
        <NormalLabel
          value={t('Tab Keeper')}
          size={TYPE.SECTION}
          color={COLORS.TEXT_COLOR}
        />
      </div>
      <div
        css={css`
          flex-shrink: 0;
        `}
      >
        <MenuContainer />
      </div>
    </div>
  );
}
