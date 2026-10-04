import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

import type { RootState } from './store';
import { saveToTabContainerInternal } from './slices/tabContainerDataStateSlice';
import { showSession } from './showSession';
import {
  buildSampleSession,
  type SampleNames,
} from '../utils/functions/sampleSession';

/**
 * KAN-7 §2. Through the save reducer, so it is selected, undoable and synced
 * like any save, but not the save thunk: a sample is no value moment for the
 * rate prompt (KAN-149) and no "saved" toast. Only into an empty list; then
 * shown, which peeks in the folded full view.
 */
export const addSampleSession =
  (names: SampleNames): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    if (getState().tabContainerDataState.tabGroups.length > 0) return;
    const sample = buildSampleSession(names, new Date(), () => uuidv4());
    dispatch(saveToTabContainerInternal(sample));
    dispatch(showSession(sample.tabGroupId));
  };
