import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { AppDispatch, RootState } from './store';
import { openPinGuide, openSetup } from './slices/globalStateSlice';
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
      dispatch(openSetup());
      return;
    }
    dispatch(openPinGuide());
  };

// A full view opened for a dialog decides only that one, through the same queue.
export const fullViewShowEntry = (
  show: FullViewShow,
  dispatch: AppDispatch
): DialogEntry => ({
  id: show,
  decide: () => () => dispatch(showInFullView(show)),
});
