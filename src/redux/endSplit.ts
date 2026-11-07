// KAN-942. End split view on a live split: Chrome ends it in place, and undo can split the two tabs again.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { keepLiveStep, whileMovingTabs } from './undoHistory';
import type { OpenTab } from '../utils/functions/openNow';
import { endLiveSplit } from '../utils/functions/openNowMoves';

// Says whether the split ended; never throws. Run as Tab Keeper's own move, so Open now reads again when it's over, a refused one too.
export const endOpenSplit =
  (
    first: OpenTab,
    second: OpenTab
  ): ThunkAction<Promise<boolean>, RootState, undefined, UnknownAction> =>
  async (dispatch, getState) => {
    const { splitViewId } = first;
    if (splitViewId === undefined || splitViewId !== second.splitViewId) {
      return false;
    }
    const withLook =
      getState().globalState.hasTabGroupsPermission &&
      Boolean(chrome.tabGroups);
    const moved = await whileMovingTabs(() =>
      endLiveSplit([first.id, second.id], splitViewId, withLook)
    );
    if (moved === null) return false;
    keepLiveStep(dispatch, { kind: 'endSplit', moved });
    return true;
  };
