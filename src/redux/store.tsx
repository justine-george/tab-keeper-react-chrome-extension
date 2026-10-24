import { configureStore } from '@reduxjs/toolkit';

import { isCloudConfigured } from '../config/firebase';

import { rootReducer } from './storeConfig';
import { customMiddleware } from './middleware/customMiddleware';
import { toastMiddleware } from './middleware/toastMiddleware';
import { storageFullMiddleware } from './middleware/storageFullMiddleware';
import { otherPageWriteMiddleware } from './middleware/otherPageWriteMiddleware';
import { setCloudConfigured } from './slices/globalStateSlice';

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      otherPageWriteMiddleware,
      customMiddleware,
      toastMiddleware,
      storageFullMiddleware
    ),
});

// KAN-750. Before the first render, so a cloud build never reads "Sync unavailable".
store.dispatch(setCloudConfigured(isCloudConfigured));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
