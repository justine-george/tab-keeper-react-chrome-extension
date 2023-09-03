import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import MenuContainer from './MenuContainer';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
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

  function handleKeyPress(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      handleClickSearch();
    }
  }

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
        onClick={handleBackClick}
        onKeyDown={(e) => handleKeyPress(e)}
        title="Go back"
        tabIndex={0}
      >
        <Icon ariaLabel="back" type="arrow_back" />
        <NormalLabel
          value="Back"
          size="1.125rem"
          color={COLORS.TEXT_COLOR}
          style="padding-left: 8px; cursor: pointer;"
        />
      </div>
    </div>
  ) : (
    <div css={containerStyle}>
      <div
        css={css`
          display: flex;
        `}
        onClick={handleClickSearch}
        onKeyDown={(e) => handleKeyPress(e)}
        title="Search"
        tabIndex={0}
      >
        <Icon ariaLabel="search" type="search" />
        <NormalLabel
          value="Tab Keeper"
          size="1.125rem"
          color={COLORS.TEXT_COLOR}
          style="cursor: pointer;"
        />
      </div>
      <div>
        <MenuContainer />
      </div>
    </div>
  );
}
