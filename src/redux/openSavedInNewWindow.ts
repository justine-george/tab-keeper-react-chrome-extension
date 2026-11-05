import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { CarriedPick } from './carriedItem';
import { copyWindowSpec } from './openCopy';
import { noteReviewMoment } from './reviewAsk';
import type { RootState } from './store';
import { withoutIncognito } from '../utils/functions/restoreSession';
import { isSampleSession } from '../utils/functions/sampleSession';
import { RESTORE_SESSION_MESSAGE } from '../utils/functions/windows';
import type { RestoreSessionRequest } from '../utils/functions/windows';

// KAN-923. A menu's Open in new window: the saved tab or group in a new normal
// window, by the worker's restore. Nothing happens for an item no longer saved.
export const openSavedInNewWindow =
  (
    tabGroupId: string,
    pick: CarriedPick,
    goToURLText: string
  ): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const state = getState();
    const window = state.tabContainerDataState.tabGroups
      .find((session) => session.tabGroupId === tabGroupId)
      ?.windows.find((saved) => saved.windowId === pick.windowId);
    const spec = window === undefined ? null : copyWindowSpec(window, pick);
    if (spec === null) return;
    const request: RestoreSessionRequest = {
      type: RESTORE_SESSION_MESSAGE,
      // The row says a new window, so a window saved incognito doesn't decide it.
      specs: [withoutIncognito(spec)],
      goToURLText,
      closeOtherWindows: false,
      pinTabKeeper: state.settingsDataState.pinTabKeeperInNewWindows,
    };
    // As Open (KAN-149): the worker's new window closes the popup, so counted when asked.
    if (!isSampleSession(tabGroupId)) {
      dispatch(noteReviewMoment({ kind: 'restored' }));
    }
    void chrome.runtime.sendMessage(request);
  };
