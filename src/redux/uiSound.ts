import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { playShutterClick } from '../utils/functions/uiSound';

// The shutter click, if Settings → Sounds is on as it plays.
export const clickShutter =
  (): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (_dispatch, getState) => {
    if (getState().settingsDataState.isUiSoundOn) playShutterClick();
  };
