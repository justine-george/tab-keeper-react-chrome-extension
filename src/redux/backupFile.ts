import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { TFunction } from 'i18next';

import type { RootState } from './store';
import { loadSessionsFromBackup, showToast } from './slices/globalStateSlice';
import { APP_VERSION, IMPORT_ERROR_FRAME } from '../utils/constants/common';
import {
  readImportedFile,
  TranslatableError,
  withoutSettings,
} from '../utils/functions/local';
import type { TabMasterContainer } from './slices/tabContainerDataStateSlice';
import {
  backupSettingsFrom,
  readBackupSettings,
  type BackupSettings,
} from '../utils/functions/backupSettings';
import { readUiLanguage } from '../utils/functions/uiLanguage';
import { refuseOversizeImport } from '../utils/functions/cloudDocument';

// The part of the i18n instance reading a backup needs, so the caller hands in its own.
interface Translator {
  language: string;
  t: TFunction;
}

type BackupThunk = ThunkAction<void, RootState, unknown, UnknownAction>;

// KAN-579. Full view only: a native Save As takes the focus, which closes the popup.
export const saveBackupFile = (): BackupThunk => (_dispatch, getState) => {
  const { tabContainerDataState, settingsDataState } = getState();
  // KAN-961. Fresh settings, only those changed from a new install; any stray field is dropped first.
  const settings = backupSettingsFrom(settingsDataState, readUiLanguage());
  const file = {
    ...withoutSettings(tabContainerDataState).container,
    ...(settings ? { settings } : {}),
  };
  const dataStr =
    'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(file));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute('href', dataStr);
  downloadAnchorNode.setAttribute(
    'download',
    `tabkeeper_backup_${APP_VERSION}_${Date.now().toString()}.json`
  );
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
};

// KAN-961. A backup file's sessions and its checked settings (null in an older backup); throws as readImportedFile does.
export function readBackupFile(content: string): {
  container: TabMasterContainer;
  settings: BackupSettings | null;
} {
  const { container, rawSettings } = readImportedFile(content);
  return { container, settings: readBackupSettings(rawSettings) };
}

// KAN-579. Full view only, as saveBackupFile: the file chooser closes the popup.
export const loadBackupFile =
  (i18n: Translator): BackupThunk =>
  (dispatch) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const content = String(reader.result);
          // Parses, validates, then refuses what sync could never write (KAN-27,
          // compressed since KAN-6). Each throws into the error toast below.
          const { container, settings } = readBackupFile(content);
          await refuseOversizeImport(container, i18n.language);

          // KAN-252/261. The file is read first, then the user is asked --
          // Merge or Replace -- unless nothing is saved here. KAN-265: that is
          // decided in the thunk, from the store as it is when the file lands.
          void dispatch(
            loadSessionsFromBackup({ container, fileName: file.name, settings })
          );
        } catch (error: unknown) {
          console.warn('Error restoring tabs', error);
          // KAN-86. Our own refusals carry a key and translate (a non-JSON
          // file too, KAN-618); an unforeseen error has none, so its English
          // detail goes inside the translated frame.
          dispatch(
            showToast({
              toastText: IMPORT_ERROR_FRAME,
              toastParams: {
                detail:
                  error instanceof TranslatableError
                    ? i18n.t(error.i18nKey, error.i18nParams)
                    : error instanceof Error
                      ? error.message
                      : String(error),
              },
            })
          );
        }
      };
      reader.readAsText(file);
    };

    input.click();
  };
