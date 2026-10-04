import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { setDefaultView } from './slices/settingsDataStateSlice';
import {
  applyDefaultView,
  DEFAULT_VIEW_KEY,
  type ActionApi,
  type DefaultView,
} from '../utils/functions/defaultView';

// Outside an extension page chrome.action is absent: a rejection, which applyDefaultView logs.
const pageActionApi: ActionApi = {
  setPopup: (details) =>
    typeof chrome.action?.setPopup === 'function'
      ? chrome.action.setPopup(details)
      : Promise.reject(new Error('chrome.action is unavailable')),
};

/**
 * KAN-7 §7. Saved first, so a refused apply still keeps the choice; then
 * mirrored for the worker, which re-applies it at every browser start; then
 * applied. Never closes a full-view tab: it may be one the user pinned.
 */
export const chooseDefaultView =
  (
    view: DefaultView
  ): ThunkAction<Promise<void>, RootState, unknown, UnknownAction> =>
  async (dispatch) => {
    dispatch(setDefaultView(view));
    try {
      await chrome.storage.local.set({ [DEFAULT_VIEW_KEY]: view });
    } catch (error) {
      console.warn('Could not mirror the default view for the worker:', error);
    }
    await applyDefaultView(pageActionApi, view);
  };
