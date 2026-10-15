import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { TFunction } from 'i18next';

import type { RootState } from './store';
import { loadSessionsFromBackup, showToast } from './slices/globalStateSlice';
import { APP_VERSION, IMPORT_ERROR_FRAME } from '../utils/constants/common';
import {
  readImportedContainer,
  TranslatableError,
} from '../utils/functions/local';

// The part of the i18n instance reading a backup needs, so the caller hands in its own.
interface Translator {
  language: string;
  t: TFunction;
}

type BackupThunk = ThunkAction<void, RootState, unknown, UnknownAction>;

// KAN-579. Full view only: a native Save As takes the focus, which closes the popup.
export const saveBackupFile = (): BackupThunk => (_dispatch, getState) => {
  const dataStr =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(getState().tabContainerDataState));
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

      reader.onload = () => {
        try {
          const content = String(reader.result);
          // Parses, validates the structure, and refuses anything that would
          // not fit in a Firestore document (KAN-27). Throws on every one of
          // those, which the catch below turns into the error toast.
          const container = readImportedContainer(content, i18n.language);

          // KAN-252/261. The file is read first, then the user is asked --
          // Merge or Replace -- unless nothing is saved here. KAN-265: that is
          // decided in the thunk, from the store as it is when the file lands.
          void dispatch(
            loadSessionsFromBackup({ container, fileName: file.name })
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
