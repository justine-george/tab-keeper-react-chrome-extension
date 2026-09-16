import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import ClickableRow from '../../common/ClickableRow';
import MenuContainer from './MenuContainer';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  closeSearchPanel,
  openSearchPanel,
} from '../../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';
import { TYPE } from '../../../styles/scale';

export default function HeroContainer() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  const dispatch: AppDispatch = useDispatch();

  const handleClickSearch = () => {
    dispatch(openSearchPanel());
  };

  const handleBackClick = () => {
    dispatch(closeSearchPanel());
  };

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

  return isSearchPanel ? (
    <div css={containerStyle}>
      <ClickableRow
        ariaLabel={t('Go back')}
        tooltipText={t('Go back')}
        onClick={handleBackClick}
        style="display: flex;"
      >
        <Icon type="arrow_back" />
        <NormalLabel
          value={t('Back')}
          size={TYPE.SECTION}
          color={COLORS.TEXT_COLOR}
          style="padding-left: 8px; cursor: pointer;"
        />
      </ClickableRow>
    </div>
  ) : (
    <div css={containerStyle}>
      <ClickableRow
        ariaLabel={t('Search')}
        tooltipText={t('Search')}
        onClick={handleClickSearch}
        style="display: flex; align-items: center; min-width: 0;"
      >
        <Icon type="search" />
        <NormalLabel
          value={t('Tab Keeper')}
          size={TYPE.SECTION}
          color={COLORS.TEXT_COLOR}
          style="cursor: pointer;"
        />
      </ClickableRow>
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
