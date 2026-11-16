import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { showToast } from './slices/globalStateSlice';
import {
  cloudSyncAllowed,
  markHadImportedSession,
  noteImportedBookmarkFolders,
  noteImportedSessions,
} from './slices/settingsDataStateSlice';
import {
  saveImportedSessionsInternal,
  type tabContainerData,
} from './slices/tabContainerDataStateSlice';
import type { FolderSession } from '../utils/functions/bookmarkImport';
import { syncBytes } from '../utils/functions/cloudDocument';
import {
  bytesToMB,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  syncLimitInMB,
} from '../utils/functions/local';
import { BOOKMARKS_IMPORTED_FRAME } from '../utils/constants/common';

type ImportThunk = ThunkAction<void, RootState, unknown, UnknownAction>;

// KAN-862. Sessions land as a save's do (ids, times, dirty flag, sync push) but are no save: no review
// moment, first-save pop or shutter, which saveToTabContainer adds. The first ends on top and selected.
// The folders they came from are recorded, so none is imported twice (11-16).
export const importBookmarkSessions =
  (made: readonly FolderSession[]): ImportThunk =>
  (dispatch) => {
    if (made.length === 0) return;
    const sessions = made.map((m) => m.session);
    dispatch(saveImportedSessionsInternal(sessions));
    dispatch(markHadImportedSession());
    dispatch(noteImportedSessions(sessions.map((s) => s.tabGroupId)));
    dispatch(noteImportedBookmarkFolders(made.map((m) => m.folderId)));
    void dispatch(
      showToast({
        toastText: BOOKMARKS_IMPORTED_FRAME,
        toastParams: { count: sessions.length },
      })
    );
  };

// KAN-862. Only with Auto sync on, and only for an import that pushes a fitting account over the limit:
// an account already over keeps its existing sync warning, as after a save. Measured as a backup is.
export async function importSizeRefusal(
  state: RootState,
  sessions: tabContainerData[],
  locale: string
): Promise<null | { used: string; limit: string }> {
  if (!cloudSyncAllowed(state.settingsDataState)) return null;
  const container = state.tabContainerDataState;
  const before = await syncBytes(container);
  if (before > FIRESTORE_MAX_DOCUMENT_BYTES) return null;
  const after = await syncBytes({
    ...container,
    tabGroups: [...sessions, ...container.tabGroups],
  });
  if (after <= FIRESTORE_MAX_DOCUMENT_BYTES) return null;
  return { used: bytesToMB(after, locale), limit: syncLimitInMB(locale) };
}

export const selectImportedSessionIds = (state: RootState): readonly string[] =>
  state.settingsDataState.importedSessionIds;

export const selectImportedBookmarkFolderIds = (
  state: RootState
): readonly string[] => state.settingsDataState.importedBookmarkFolderIds;
