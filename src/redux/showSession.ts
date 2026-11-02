import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { peekSavedSession } from './slices/globalStateSlice';
import { selectTabContainer } from './slices/tabContainerDataStateSlice';
import { selectIsSavedSessionFolded } from './savedSessionFold';
import { isTabView } from '../utils/functions/viewMode';
import { runPaneMotion } from '../components/home/paneMotion';
import type { RootState } from './store';

// KAN-350. Puts a saved session on screen: what a click on its row does, and
// what a toast's Show chip does. Folded, the tab view peeks first, the
// selected session included, since it is the natural one to ask to see. Only
// while folded: a peek left set side by side would keep this page open
// through a later fold from another page's settings (KAN-280 O5). Then the
// session is selected, unless it already is; the list's own effect scrolls
// the selected row into view.
//
// An id that is no longer in the list does nothing at all, peek included:
// there is nothing to show.
export const showSession =
  (tabGroupId: string): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const state = getState();
    const { tabGroups, selectedTabGroupId } = state.tabContainerDataState;
    if (!tabGroups.some((group) => group.tabGroupId === tabGroupId)) return;
    const select = () => {
      if (selectedTabGroupId !== tabGroupId)
        dispatch(selectTabContainer(tabGroupId));
    };
    if (!isTabView() || !selectIsSavedSessionFolded(state)) {
      select();
      return;
    }
    // KAN-889. The same slide as Show the saved session, with the session it shows.
    runPaneMotion(
      () => {
        dispatch(peekSavedSession());
        select();
      },
      'saved',
      'unfold'
    );
  };
