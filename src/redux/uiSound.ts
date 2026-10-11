import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import {
  playShutterClick,
  prepareShutterClick,
} from '../utils/functions/uiSound';

// The click's audio, opened ahead of it (KAN-513), if Settings → Sounds is on.
export const prepareShutter =
  (): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (_dispatch, getState) => {
    if (getState().settingsDataState.isUiSoundOn) prepareShutterClick();
  };

// The shutter click, if Settings → Sounds is on as it plays.
export const clickShutter =
  (): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (_dispatch, getState) => {
    if (getState().settingsDataState.isUiSoundOn) playShutterClick();
  };
