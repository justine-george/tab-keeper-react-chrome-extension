import { useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { RootState } from '../../redux/store';
import HeroContainerRight from './HeroContainerRight';
import { filterTabGroups } from '../../utils/helperFunctions';
import TabGroupDetailsContainer from './TabGroupDetailsContainer';

export default function RightPane() {
  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  const searchInputText = useSelector(
    (state: RootState) => state.globalState.searchInputText
  );

  let filteredTabGroups = tabContainerDataList.tabGroups.filter(
    (tabGroup) => tabGroup.isSelected
  );
  if (isSearchPanel && searchInputText) {
    filteredTabGroups = filterTabGroups(searchInputText, filteredTabGroups);
  }

  // to identify whether no tab groups are selected
  const isNoneSelected = filteredTabGroups.length === 0;

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    height: 100%;
  `;

  return (
    <>
      {/* Only render right pane when atleast one selected item exists */}
      {!isNoneSelected && (
        <div css={containerStyle}>
          <HeroContainerRight />
          <TabGroupDetailsContainer />
        </div>
      )}
    </>
  );
}
