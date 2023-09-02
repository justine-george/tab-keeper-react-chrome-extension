import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { RootState } from '../store';
import { setPresentStartup } from './undoRedoSlice';
import { selectCategory } from './settingsCategoryStateSlice';
import { replaceState, TabMasterContainer } from './tabContainerDataStateSlice';
import {
  loadFromFirestore,
  loadFromLocalStorage,
  saveToFirestore,
  saveToLocalStorage,
} from '../../utils/helperFunctions';

interface ConflictModalPayload {
  tabDataLocal: TabMasterContainer;
  tabDataCloud: TabMasterContainer;
}

export interface Global {
  hasSyncedBefore: boolean;
  isSignedIn: boolean;
  userId: string | null;
  isDirty: boolean;
  isSettingsPage: boolean;
  isSearchPanel: boolean;
  searchInputText: string;
  syncStatus: 'idle' | 'loading' | 'success' | 'error';
  isToastOpen: boolean;
  toastText: string;
  isConflictModalOpen: boolean;
  tabDataLocal: TabMasterContainer | null;
  tabDataCloud: TabMasterContainer | null;
}

export const initialState: Global = {
  hasSyncedBefore: false,
  isSignedIn: false,
  userId: null,
  isDirty: false,
  isSettingsPage: false,
  isSearchPanel: false,
  searchInputText: '',
  syncStatus: 'idle',
  isToastOpen: false,
  toastText: '',
  isConflictModalOpen: false,
  tabDataLocal: null,
  tabDataCloud: null,
};

// save data to Firestore if dirty, saves latest to localStorage at the end
export const saveToFirestoreIfDirty = createAsyncThunk(
  'global/saveToFirestoreIfDirty',
  async (_, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;

    try {
      if (state.globalState.isDirty) {
        await saveToFirestore(
          state.globalState.userId!,
          state.tabContainerDataState,
          thunkAPI
        );
        // Save to localStorage after successful Firestore update
        saveToLocalStorage('tabContainerData', state.tabContainerDataState);
        thunkAPI.dispatch(setIsNotDirty());
      }
    } catch (error: any) {
      console.warn('Error updating Firestore: ', error.message);
      thunkAPI.dispatch(
        showToast({
          toastText: 'Sync error:' + error.message,
          duration: 3000,
        })
      );
    }
  }
);

// syncs data with Firestore
export const syncStateWithFirestore = createAsyncThunk(
  'global/syncStateWithFirestore',
  async (_, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;

    // load from Firestore
    const tabDataFromCloud: TabMasterContainer | undefined =
      await loadFromFirestore(state.globalState.userId!, thunkAPI);
    // log data loaded from cloud
    console.log(`from cloud`);
    console.log(tabDataFromCloud);

    const tabDataFromLocalStorage: TabMasterContainer =
      loadFromLocalStorage('tabContainerData');
    // log data loaded from localStorage
    console.log(`from localStorage`);
    console.log(tabDataFromLocalStorage);

    if (tabDataFromCloud && tabDataFromLocalStorage) {
      console.log(
        `data present on both local and cloud, possiblity of conflict`
      );
      // data present on both local and cloud, possiblity of conflict
      const cloudTimestamp = tabDataFromCloud.lastModified;
      const localTimestamp = tabDataFromLocalStorage.lastModified;

      if (localTimestamp !== cloudTimestamp) {
        if (localTimestamp > cloudTimestamp) {
          thunkAPI.dispatch(replaceState(tabDataFromLocalStorage));
          thunkAPI.dispatch(setIsDirty());
          thunkAPI.dispatch(saveToFirestoreIfDirty());
          if (!state.globalState.hasSyncedBefore) {
            // reset presentState in the undoRedoState
            thunkAPI.dispatch(
              setPresentStartup({
                tabContainerDataState: tabDataFromLocalStorage,
              })
            );
          }
          thunkAPI.dispatch(setHasSyncedBefore());
        } else {
          console.log(`cloud is latest, let user decide.`);
          if (!state.globalState.isDirty) {
            console.log(
              `local is not dirty, so might want to overwrite it with cloud data. Still let user decide.`
            );
          }
          // data conflict!
          thunkAPI.dispatch(
            openConflictModal({
              tabDataLocal: tabDataFromLocalStorage,
              tabDataCloud: tabDataFromCloud,
            })
          );
        }
      } else {
        thunkAPI.dispatch(setHasSyncedBefore());
      }
    } else if (tabDataFromCloud) {
      console.log(
        `newly installed returning user - data present only on cloud`
      );
      // newly installed returning user - data present only on cloud
      thunkAPI.dispatch(replaceState(tabDataFromCloud!));
      thunkAPI.dispatch(setIsNotDirty());
      if (!state.globalState.hasSyncedBefore) {
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(
          setPresentStartup({
            tabContainerDataState: tabDataFromCloud!,
          })
        );
      }
      thunkAPI.dispatch(setHasSyncedBefore());
    } else if (tabDataFromLocalStorage) {
      console.log(`data only on localStorage`);
      // data only on localStorage - least likely
      // local storage has tabData
      // save back to Firestore
      thunkAPI.dispatch(replaceState(tabDataFromLocalStorage));
      thunkAPI.dispatch(setIsDirty());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
      if (!state.globalState.hasSyncedBefore) {
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(
          setPresentStartup({
            tabContainerDataState: tabDataFromLocalStorage,
          })
        );
      }
      thunkAPI.dispatch(setHasSyncedBefore());
    } else {
      console.log(`new user - hey there!`);
      // new user - hey there!
      thunkAPI.dispatch(setIsDirty());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
      thunkAPI.dispatch(setHasSyncedBefore());
    }
  }
);

export const openSettingsPage = createAsyncThunk(
  'global/openSettingsPage',
  async (settingsName: string | undefined, thunkAPI) => {
    if (settingsName) thunkAPI.dispatch(selectCategory(settingsName));
  }
);

interface ShowToastPayload {
  toastText: string;
  duration?: number;
}

let toastTimeout: number | null = null;
export const showToast = createAsyncThunk(
  'global/showToast',
  async ({ toastText, duration = 5000 }: ShowToastPayload, thunkAPI) => {
    if (toastText) {
      // If there's an existing toast timeout, clear it
      if (toastTimeout !== null) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
      }

      thunkAPI.dispatch(setToastText(toastText));
      thunkAPI.dispatch(openToast());

      // Set the new timeout for the current toast
      toastTimeout = setTimeout(() => {
        thunkAPI.dispatch(closeToast());
      }, duration);
    }
  }
);

export const globalStateSlice = createSlice({
  name: 'globalState',
  initialState,
  reducers: {
    openConflictModal: (state, action: PayloadAction<ConflictModalPayload>) => {
      state.tabDataLocal = action.payload.tabDataLocal;
      state.tabDataCloud = action.payload.tabDataCloud;
      state.isConflictModalOpen = true;
    },

    closeConflictModal: (state) => {
      state.isConflictModalOpen = false;
    },

    openSearchPanel: (state) => {
      state.isSearchPanel = true;
    },

    closeSearchPanel: (state) => {
      state.isSearchPanel = false;
    },

    setSearchInputText: (state, action: PayloadAction<string>) => {
      state.searchInputText = action.payload;
    },

    openToast: (state) => {
      state.isToastOpen = true;
    },

    closeToast: (state) => {
      state.isToastOpen = false;
    },

    setToastText: (state, action: PayloadAction<string>) => {
      state.toastText = action.payload;
    },

    closeSettingsPage: (state) => {
      state.isSettingsPage = false;
    },

    setIsNotDirty: (state) => {
      state.isDirty = false;
    },

    setIsDirty: (state) => {
      state.isDirty = true;
      state.syncStatus = 'idle';
    },

    setSignedIn: (state) => {
      state.isSignedIn = true;
    },

    setHasSyncedBefore: (state) => {
      state.hasSyncedBefore = true;
    },

    setLoggedOut: (state) => {
      state.isSignedIn = false;
      state.syncStatus = 'idle';
    },

    setUserId: (state, action: PayloadAction<string>) => {
      state.userId = action.payload;
    },

    removeUserId: (state) => {
      state.userId = null;
    },

    replaceState: (state, action: PayloadAction<typeof state>) =>
      action.payload,
  },

  extraReducers: (builder) => {
    builder
      .addCase(syncStateWithFirestore.pending, (state) => {
        state.syncStatus = 'loading';
      })
      .addCase(syncStateWithFirestore.fulfilled, (state) => {
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = 'success';
        } else {
          state.syncStatus = 'error';
        }
      })
      .addCase(syncStateWithFirestore.rejected, (state) => {
        state.syncStatus = 'error';
      })
      .addCase(saveToFirestoreIfDirty.pending, (state) => {
        state.syncStatus = 'loading';
      })
      .addCase(saveToFirestoreIfDirty.fulfilled, (state) => {
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = 'success';
        } else {
          state.syncStatus = 'error';
        }
      })
      .addCase(saveToFirestoreIfDirty.rejected, (state) => {
        state.syncStatus = 'error';
      })
      .addCase(openSettingsPage.fulfilled, (state) => {
        state.isSettingsPage = true;
      })
      .addCase(showToast.fulfilled, () => {});
  },
});

export const {
  openConflictModal,
  closeConflictModal,
  openSearchPanel,
  closeSearchPanel,
  setSearchInputText,
  openToast,
  closeToast,
  setToastText,
  closeSettingsPage,
  setIsDirty,
  setIsNotDirty,
  setSignedIn,
  setHasSyncedBefore,
  setLoggedOut,
  setUserId,
  removeUserId,
} = globalStateSlice.actions;

export default globalStateSlice.reducer;
