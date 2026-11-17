import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import i18next from 'i18next';

import type { RootState } from './store';
import { chooseLanguage } from './languageChoice';
import { chooseToolbarIcon } from './toolbarIconChoice';
import { chooseDefaultView } from './defaultViewChoice';
import {
  setCopyLinksLayout,
  setDefaultSaveScope,
  setExportLayout,
  setFoldOpenNowInTabView,
  setFoldSavedSessionInTabView,
  setOpenSavedWindowsIn,
  setPinTabKeeperInNewWindows,
  setSessionDateBasis,
  setSkipDuplicateTabs,
  setSkipTabsAlreadyOpen,
  setTheme,
  setTimeFormat,
} from './slices/settingsDataStateSlice';
import type { BackupSettings } from '../utils/functions/backupSettings';

/**
 * KAN-961. A backup's settings, each through the way Settings sets it: the
 * language switches i18n too, and the toolbar icon and default view reach the
 * worker's mirrors. A setting the file leaves out keeps this computer's value.
 */
export const applyBackupSettings =
  (
    settings: BackupSettings
  ): ThunkAction<Promise<void>, RootState, unknown, UnknownAction> =>
  async (dispatch) => {
    const s = settings;
    if (s.theme !== undefined) dispatch(setTheme(s.theme));
    if (s.timeFormat !== undefined) dispatch(setTimeFormat(s.timeFormat));
    if (s.sessionDateBasis !== undefined) {
      dispatch(setSessionDateBasis(s.sessionDateBasis));
    }
    if (s.exportLayout !== undefined) dispatch(setExportLayout(s.exportLayout));
    if (s.pinTabKeeperInNewWindows !== undefined) {
      dispatch(setPinTabKeeperInNewWindows(s.pinTabKeeperInNewWindows));
    }
    if (s.defaultSaveScope !== undefined) {
      dispatch(setDefaultSaveScope(s.defaultSaveScope));
    }
    if (s.copyLinksLayout !== undefined) {
      dispatch(setCopyLinksLayout(s.copyLinksLayout));
    }
    if (s.openSavedWindowsIn !== undefined) {
      dispatch(setOpenSavedWindowsIn(s.openSavedWindowsIn));
    }
    if (s.skipDuplicateTabs !== undefined) {
      dispatch(setSkipDuplicateTabs(s.skipDuplicateTabs));
    }
    if (s.skipTabsAlreadyOpen !== undefined) {
      dispatch(setSkipTabsAlreadyOpen(s.skipTabsAlreadyOpen));
    }
    // The reducers keep one fold at a time; the file never has both on (readBackupSettings).
    if (s.foldSavedSessionInTabView !== undefined) {
      dispatch(setFoldSavedSessionInTabView(s.foldSavedSessionInTabView));
    }
    if (s.foldOpenNowInTabView !== undefined) {
      dispatch(setFoldOpenNowInTabView(s.foldOpenNowInTabView));
    }
    if (s.toolbarIcon !== undefined) {
      await dispatch(chooseToolbarIcon(s.toolbarIcon));
    }
    if (s.defaultView !== undefined) {
      await dispatch(chooseDefaultView(s.defaultView));
    }
    // Awaited, so what follows (the toast) shows in the new language.
    if (s.language !== undefined) {
      await dispatch(chooseLanguage(s.language, i18next));
    }
  };
