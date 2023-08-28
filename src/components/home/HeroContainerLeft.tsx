import { css } from '@emotion/react';
import MenuContainer from './MenuContainer';
import { useThemeColors } from '../hook/useThemeColors';
import { NormalLabel } from '../common/Label';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../redux/store';
import Icon from '../common/Icon';
import {
  closeSearchPanel,
  openSearchPanel,
} from '../../redux/slice/globalStateSlice';

export default function HeroContainer() {
  const COLORS = useThemeColors();

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
    font-family: 'Libre Franklin', sans-serif;
    font-size: 1.25rem;
    padding: 16px 0px;
    user-select: none;
  `;

  return isSearchPanel ? (
    <div css={containerStyle}>
      <div
        css={css`
          display: flex;
        `}
      >
        <Icon type="arrow_back" onClick={handleBackClick} />
        <NormalLabel
          value="Back"
          size="1.125rem"
          color={COLORS.TEXT_COLOR}
          style="padding-left: 8px;"
        />
      </div>
    </div>
  ) : (
    <div css={containerStyle}>
      <div
        css={css`
          display: flex;
        `}
      >
        <Icon type="search" onClick={handleClickSearch} />
        <NormalLabel
          value="Tab Keeper"
          size="1.125rem"
          color={COLORS.TEXT_COLOR}
        />
      </div>
      <div>
        <MenuContainer />
      </div>
    </div>
  );
}
