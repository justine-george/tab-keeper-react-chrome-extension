import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { setToolbarIcon } from './slices/settingsDataStateSlice';
import {
  applyToolbarIcon,
  TOOLBAR_ICON_KEY,
  type ToolbarIcon,
  type ToolbarIconApi,
} from '../utils/functions/toolbarIcon';

const pageActionApi: ToolbarIconApi = {
  setIcon: (details) => chrome.action.setIcon(details),
};

// KAN-932. Saved first, so a refused apply still keeps the choice; then mirrored
// for the worker, which applies it again at every start; then applied.
export const chooseToolbarIcon =
  (
    icon: ToolbarIcon
  ): ThunkAction<Promise<void>, RootState, unknown, UnknownAction> =>
  async (dispatch) => {
    dispatch(setToolbarIcon(icon));
    try {
      await chrome.storage.local.set({ [TOOLBAR_ICON_KEY]: icon });
    } catch (error) {
      console.warn('Could not mirror the toolbar icon for the worker:', error);
    }
    await applyToolbarIcon(pageActionApi, icon);
  };
