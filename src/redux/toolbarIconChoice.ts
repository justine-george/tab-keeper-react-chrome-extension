import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { setToolbarIcon } from './slices/settingsDataStateSlice';
import {
  applyToolbarIcon,
  TOOLBAR_ICON_KEY,
  TOOLBAR_MODE_KEY,
  type ToolbarIcon,
  type ToolbarIconApi,
  type ToolbarMode,
} from '../utils/functions/toolbarIcon';

type Thunk = ThunkAction<Promise<void>, RootState, unknown, UnknownAction>;

const pageActionApi: ToolbarIconApi = {
  setIcon: (details) => chrome.action.setIcon(details),
};

const mirror = async (items: Record<string, string>) => {
  try {
    await chrome.storage.local.set(items);
  } catch (error) {
    console.warn('Could not mirror the toolbar icon for the worker:', error);
  }
};

// KAN-932. Saved first, so a refused apply still keeps the choice; then mirrored
// for the worker, which applies it again at every start. Monochrome's apply is
// followToolbarMode's, which runs on the change this makes.
export const chooseToolbarIcon =
  (icon: ToolbarIcon): Thunk =>
  async (dispatch) => {
    dispatch(setToolbarIcon(icon));
    await mirror({ [TOOLBAR_ICON_KEY]: icon });
    if (icon === 'colour') {
      await applyToolbarIcon(pageActionApi, 'colour', 'light');
    }
  };

// KAN-933. A page in Monochrome, on opening and on every mode change.
export const followToolbarMode =
  (mode: ToolbarMode): Thunk =>
  async () => {
    await mirror({ [TOOLBAR_MODE_KEY]: mode });
    await applyToolbarIcon(pageActionApi, 'monochrome', mode);
  };
