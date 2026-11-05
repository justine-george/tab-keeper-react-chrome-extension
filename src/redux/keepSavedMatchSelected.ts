import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { selectTabContainer } from './slices/tabContainerDataStateSlice';
import type { RootState } from './store';
import { filterTabGroups } from '../utils/functions/local';
import { searchTermOf } from '../utils/functions/openNowSearch';

// KAN-496. Run in the update that may end the match, so the detail pane never goes
// empty for a commit: the header stays mounted, and with it the title's focus.
export const keepSavedMatchSelected =
  (searchText: string): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const searchTerm = searchTermOf(searchText);
    if (searchTerm === null) return;
    const { tabGroups, selectedTabGroupId } = getState().tabContainerDataState;
    const matches = filterTabGroups(
      searchTerm,
      tabGroups,
      getState().globalState.hasTabGroupsPermission
    );
    if (matches.length === 0) return;
    if (matches.some((g) => g.tabGroupId === selectedTabGroupId)) return;
    dispatch(selectTabContainer(matches[0].tabGroupId));
  };
