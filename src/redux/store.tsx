import { configureStore } from '@reduxjs/toolkit';

import { rootReducer } from './storeConfig';
import { customMiddleware } from './middleware/customMiddleware';
import { toastMiddleware } from './middleware/toastMiddleware';
import { storageFullMiddleware } from './middleware/storageFullMiddleware';

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      customMiddleware,
      toastMiddleware,
      storageFullMiddleware
    ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
