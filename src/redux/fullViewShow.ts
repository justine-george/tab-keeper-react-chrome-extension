import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import i18next from 'i18next';

import type { AppDispatch, RootState } from './store';
import {
  closePinGuide,
  closeSettingsPage,
  closeSetup,
  openPinGuide,
  openSettingsPage,
  openSetup,
  setEndingCard,
  setSearchInputText,
} from './slices/globalStateSlice';
import { SettingsCategory } from './slices/settingsCategoryStateSlice';
import { loadBackupFile, saveBackupFile } from './backupFile';
import { restartSetup } from './slices/settingsDataStateSlice';
import type { FullViewShow } from '../utils/functions/popOut';
import type { DialogEntry } from '../utils/functions/dialogQueue';
import { applyOtherPageSettings } from './otherPageChanges';
import { runOpener } from './firstRun';
import { reportRunCheck } from './firstOpenDialogs';
import { runningRunAtOpen } from '../utils/functions/firstRun';
import { RUN_LOCK, tourLockState } from '../utils/functions/tourLock';

// KAN-624. The worker focused this full view for a run the popup started: decided as an open would.
const resumeRunOnRequest =
  (): ThunkAction<Promise<void>, RootState, undefined, UnknownAction> =>
  async (dispatch, getState) => {
    // The popup wrote the record before asking; this page's storage event may not have landed yet.
    const { languageChanged } = dispatch(applyOtherPageSettings());
    if (languageChanged !== null) void i18next.changeLanguage(languageChanged);
    if (getState().globalState.isRunHere) return;
    const decision = await runningRunAtOpen(
      'full',
      getState().settingsDataState.firstRun,
      () => tourLockState(RUN_LOCK)
    );
    if (decision === null) return;
    reportRunCheck(decision.check);
    if (decision.action === 'nothing') return;
    // As a start does: a fresh open has neither, and either would hide the card.
    dispatch(closeSettingsPage());
    dispatch(setSearchInputText(''));
    // The run outranks both at an open. Closed, not dismissed: a finished run leads to them, a later open shows them.
    dispatch(closeSetup());
    dispatch(closePinGuide());
    runOpener(decision, dispatch)?.();
  };

// In the full view: never over a dialog already showing there.
export const showInFullView =
  (
    show: FullViewShow
  ): ThunkAction<void, RootState, undefined, UnknownAction> =>
  (dispatch) => {
    // The run is not a dialog: it shows whatever is open.
    if (show === 'run') {
      void dispatch(resumeRunOnRequest());
      return;
    }
    if (document.querySelector('dialog:modal') !== null) return;
    if (show === 'setup') {
      // KAN-589. Over the home page, as Show me around's run starts there.
      dispatch(closeSettingsPage());
      // KAN-879. Never on a replay: this setup takes away an ending shown or waiting.
      dispatch(setEndingCard(null));
      dispatch(restartSetup());
      dispatch(openSetup({ leadsToPinGuide: false, isReplay: true }));
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
