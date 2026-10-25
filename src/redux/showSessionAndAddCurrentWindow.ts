import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { addCurrWindowToTabGroup } from './slices/tabContainerDataStateSlice';
import { showSession } from './showSession';
import type { RootState } from './store';
import {
  isTabKeeperPage,
  readCurrentWindowGroups,
  toWindowGroupData,
} from '../utils/functions/capture';
import { readRecentTabs } from '../utils/functions/recentTabs';

// KAN-775. The header chip's Add current window, and a row menu's: the session goes on screen first, so the toast's "this session" is the one shown.
export const showSessionAndAddCurrentWindow =
  (
    tabGroupId: string
  ): ThunkAction<Promise<void>, RootState, unknown, UnknownAction> =>
  async (dispatch) => {
    const windowData = await new Promise<chrome.windows.Window>((resolve) =>
      chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
    );

    // KAN-279 D14 / KAN-300. Leaves out every Tab Keeper page -- the SAME
    // rule captureOpenWindows applies (isTabKeeperPage, capture.ts), since
    // this builds a window the same shape a capture would, without going
    // through captureOpenWindows itself.
    const tabs = (windowData.tabs ?? []).filter((tab) => !isTabKeeperPage(tab));
    // If that empties the window, there is nothing to add, or to show.
    if (tabs.length === 0) return;

    const read = await readCurrentWindowGroups(windowData.id);
    const recentTabsOf = await readRecentTabs(
      windowData.id === undefined ? [] : [windowData.id]
    );
    const window = toWindowGroupData(
      { ...windowData, tabs },
      read?.groups,
      read?.idByChromeId ?? new Map(),
      recentTabsOf(windowData.id)
    );

    dispatch(showSession(tabGroupId));
    await dispatch(addCurrWindowToTabGroup({ tabGroupId, window }));
  };
