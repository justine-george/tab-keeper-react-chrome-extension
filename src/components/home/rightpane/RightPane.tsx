import { useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { RootState } from '../../../redux/store';
import HeroContainerRight from './HeroContainerRight';
import { selectVisibleTabGroups } from '../../../utils/functions/local';
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

  // the same list both children below read, so the guard here cannot disagree
  // with what they find
  const visibleTabGroups = selectVisibleTabGroups(
    tabContainerDataList.tabGroups,
    isSearchPanel,
    searchInputText
  );

  // to identify whether no tab groups are selected
  const isNoneSelected = visibleTabGroups.length === 0;

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
