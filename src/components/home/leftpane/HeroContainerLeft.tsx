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
    height: 60px;
    align-items: center;
    font-family: ${FONT_FAMILY};
    font-size: 1.25rem;
    padding: 16px 0px;
    user-select: none;
  `;

  return isSearchPanel ? (
    <div css={containerStyle}>
      <ClickableRow
        ariaLabel="back"
        tooltipText={t('Go back')}
        onClick={handleBackClick}
        style="display: flex;"
      >
        <Icon type="arrow_back" />
        <NormalLabel
          value={t('Back')}
          size="1.125rem"
          color={COLORS.TEXT_COLOR}
          style="padding-left: 8px; cursor: pointer;"
        />
      </ClickableRow>
    </div>
  ) : (
    <div css={containerStyle}>
      <ClickableRow
        ariaLabel="search"
        tooltipText={t('Search')}
        onClick={handleClickSearch}
        style="display: flex; align-items: center; min-width: 0;"
      >
        <Icon type="search" />
        <NormalLabel
          value={t('Tab Keeper')}
          size="1.125rem"
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
