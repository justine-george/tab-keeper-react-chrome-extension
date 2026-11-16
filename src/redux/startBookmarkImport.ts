import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import {
  closeImportBookmarks,
  openImportBookmarks,
  showToast,
} from './slices/globalStateSlice';
import { importedBookmarkKeys } from './bookmarkImport';
import {
  nothingToImport,
  type NothingToImport,
} from '../utils/functions/bookmarkImport';
import { TOAST_MESSAGES } from '../utils/constants/common';
import {
  removeBookmarksPermission,
  requestBookmarksPermission,
} from '../utils/functions/permissions';
import { requestTabView } from '../utils/functions/popOut';
import { isTabView } from '../utils/functions/viewMode';

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;
type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

export async function readBookmarkRoot(): Promise<BookmarkNode> {
  const [root] = await chrome.bookmarks.getTree();
  if (root === undefined)
    throw new Error('chrome.bookmarks.getTree returned no root');
  return root;
}

// How a press on an import ended. 'handedOff': the popup passed it to the full view.
export type ImportStart =
  'handedOff' | 'declined' | 'unreadable' | 'opened' | NothingToImport;

export const isNothingToImport = (
  start: ImportStart
): start is NothingToImport =>
  start === 'allImported' || start === 'noBookmarks';

// KAN-862 R23. What says there is nothing to import: a toast, or the line in setup's import step.
export const NOTHING_TO_IMPORT_TEXT: Record<NothingToImport, string> = {
  allImported: TOAST_MESSAGES.BOOKMARKS_ALL_IMPORTED,
  noBookmarks: TOAST_MESSAGES.NO_BOOKMARKS_TO_IMPORT,
};

// KAN-862. The prompt would close the popup, so the popup hands the import to the full view, which asks.
// Declined: nothing opens, and the next press asks again. Nothing left to import (R23): no dialog, and the
// permission goes straight back through the dialog's own way out.
export const startBookmarkImport =
  (): Thunk<Promise<ImportStart>> => async (dispatch, getState) => {
    if (!isTabView()) {
      await requestTabView('importBookmarks');
      return 'handedOff';
    }
    if (!(await requestBookmarksPermission())) return 'declined';
    let root: BookmarkNode;
    try {
      root = await readBookmarkRoot();
    } catch {
      await dispatch(endBookmarkImport());
      void dispatch(
        showToast({ toastText: TOAST_MESSAGES.BOOKMARKS_UNREADABLE })
      );
      return 'unreadable';
    }
    const nothing = nothingToImport(
      root,
      chrome.runtime.getURL(''),
      importedBookmarkKeys(getState().settingsDataState.importedBookmarks)
    );
    if (nothing !== null) {
      await dispatch(endBookmarkImport());
      return nothing;
    }
    dispatch(openImportBookmarks());
    return 'opened';
  };

// KAN-862 R23. Settings' press: nothing left to import is said in a toast.
export const importBookmarksFromSettings =
  (): Thunk<Promise<void>> => async (dispatch) => {
    const start = await dispatch(startBookmarkImport());
    if (isNothingToImport(start))
      void dispatch(showToast({ toastText: NOTHING_TO_IMPORT_TEXT[start] }));
  };

// KAN-862. The dialog's one way out, whatever closed it: the permission goes back with it.
export const endBookmarkImport =
  (): Thunk<Promise<void>> => async (dispatch) => {
    dispatch(closeImportBookmarks());
    await removeBookmarksPermission();
  };

// KAN-862. A full view closed or reloaded with the dialog open never ran endBookmarkImport, so each full view
// gives a leftover grant back as it starts. A second full view so ends a first one's open dialog: its Import
// re-read then fails and it closes with BookmarksUnreadable.
export const releaseStrandedBookmarksPermission =
  (): Thunk<Promise<void>> => async (_dispatch, getState) => {
    if (getState().globalState.isImportBookmarksOpen) return;
    await removeBookmarksPermission();
  };
