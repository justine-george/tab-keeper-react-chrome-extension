import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { peekSavedSession } from './slices/globalStateSlice';
import { selectTabContainer } from './slices/tabContainerDataStateSlice';
import { selectIsSavedSessionFolded } from './savedSessionFold';
import { isTabView } from '../utils/functions/viewMode';
import { runPaneMotion } from '../components/home/paneMotion';
import type { RootState } from './store';

// KAN-350. Puts a saved session on screen: what a click on its row does, and
// what a toast's Show chip does. The session is selected, unless it already
// is; the list's own effect scrolls the selected row into view. Folded, the
// tab view then peeks, sliding in (KAN-889), the selected session included,
// since it is the natural one to ask to see. Only while folded: a peek left
// set side by side would keep this page open through a later fold from
// another page's settings (KAN-280 O5).
//
// An id that is no longer in the list does nothing at all, peek included:
// there is nothing to show.
export const showSession =
  (tabGroupId: string): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const state = getState();
    const { tabGroups, selectedTabGroupId } = state.tabContainerDataState;
    if (!tabGroups.some((group) => group.tabGroupId === tabGroupId)) return;
    // At once, so a caller's next dispatch (a rename, the tour's next step) sees it selected.
    if (selectedTabGroupId !== tabGroupId)
      dispatch(selectTabContainer(tabGroupId));
    if (!isTabView() || !selectIsSavedSessionFolded(state)) return;
    // KAN-889. The same slide as Show the saved session; folded, the detail is drawn only once it peeks.
    runPaneMotion(() => dispatch(peekSavedSession()), 'saved', 'unfold');
  };
