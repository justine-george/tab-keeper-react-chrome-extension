import { memo } from 'react';

import { useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { RootState } from '../../../redux/store';
import HeroContainerRight from './HeroContainerRight';
import { selectVisibleTabGroups } from '../../../utils/functions/local';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import TabGroupDetailsContainer from './TabGroupDetailsContainer';

function RightPane() {
  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  const { text: searchText } = useSavedSearch();

  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );

  // the same list both children below read, so the guard here cannot disagree
  // with what they find
  const visibleTabGroups = selectVisibleTabGroups(
    tabContainerDataList.tabGroups,
    searchText,
    hasTabGroupsPermission
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

// Memoised (KAN-321 O1a): MainContainer re-renders on every pointermove of
// an Open now resize, and this pane has nothing to redraw for it.
export default memo(RightPane);
