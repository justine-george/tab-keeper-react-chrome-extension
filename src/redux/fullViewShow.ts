import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import i18next from 'i18next';

import type { AppDispatch, RootState } from './store';
import {
  openPinGuide,
  openSettingsPage,
  openSetup,
} from './slices/globalStateSlice';
import { SettingsCategory } from './slices/settingsCategoryStateSlice';
import { loadBackupFile, saveBackupFile } from './backupFile';
import { restartSetup } from './slices/settingsDataStateSlice';
import type { FullViewShow } from '../utils/functions/popOut';
import type { DialogEntry } from '../utils/functions/dialogQueue';

// In the full view: never over a dialog already showing there.
export const showInFullView =
  (show: FullViewShow): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch) => {
    if (document.querySelector('dialog:modal') !== null) return;
    if (show === 'setup') {
      dispatch(restartSetup());
      dispatch(openSetup({ leadsToPinGuide: false }));
      return;
    }
    if (show === 'pinGuide') {
      dispatch(openPinGuide());
      return;
    }
    // KAN-579. On the pane its button sits on, so a picker Chrome refuses leaves the button to press.
    void dispatch(openSettingsPage(SettingsCategory.SYNC));
    // i18next's default instance is the app's (config/i18n.tsx).
    dispatch(
      show === 'saveBackup' ? saveBackupFile() : loadBackupFile(i18next)
    );
  };

// A full view opened for a dialog decides only that one, through the same queue.
export const fullViewShowEntry = (
  show: FullViewShow,
  dispatch: AppDispatch
): DialogEntry => ({
  id: show,
  decide: () => () => dispatch(showInFullView(show)),
});
