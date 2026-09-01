import { configureStore } from '@reduxjs/toolkit';

import { rootReducer } from './storeConfig';
import { customMiddleware } from './middleware/customMiddleware';

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(customMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
