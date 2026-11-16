import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import {
  closeImportBookmarks,
  openImportBookmarks,
} from './slices/globalStateSlice';
import {
  removeBookmarksPermission,
  requestBookmarksPermission,
} from '../utils/functions/permissions';
import { requestTabView } from '../utils/functions/popOut';
import { isTabView } from '../utils/functions/viewMode';

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// KAN-862. The prompt would close the popup, so the popup hands the import to the full view, which asks.
// Declined: nothing opens, and the next press asks again.
export const startBookmarkImport =
  (): Thunk<Promise<void>> => async (dispatch) => {
    if (!isTabView()) {
      await requestTabView('importBookmarks');
      return;
    }
    if (await requestBookmarksPermission()) dispatch(openImportBookmarks());
  };

// KAN-862. The dialog's one way out, whatever closed it: the permission goes back with it.
export const endBookmarkImport =
  (): Thunk<Promise<void>> => async (dispatch) => {
    dispatch(closeImportBookmarks());
    await removeBookmarksPermission();
  };
