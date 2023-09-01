import { doc, setDoc } from 'firebase/firestore';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { RootState } from '../store';
import { setPresentStartup } from './undoRedoSlice';
import { selectCategory } from './settingsCategoryStateSlice';
import { db, fetchDataFromFirestore } from '../../config/firebase';
import { replaceState, TabMasterContainer } from './tabContainerDataStateSlice';
import {
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../utils/helperFunctions';

interface ConflictModalPayload {
  tabDataLocal: TabMasterContainer;
  tabDataCloud: TabMasterContainer;
}

export interface Global {
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

// save data to Firestore if local data is dirty
export const syncToFirestore = createAsyncThunk(
  'global/syncToFirestore',
  async (_, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;

    if (state.globalState.isDirty) {
      try {
        await setDoc(doc(db, 'tabGroupData', state.globalState.userId!), {
          ...state.tabContainerDataState,
        });

        // Save to localStorage after successful Firestore update
        saveToLocalStorage('tabContainerData', state.tabContainerDataState);
        thunkAPI.dispatch(setIsNotDirty());

        return { status: 'success' };
      } catch (error) {
        console.warn('Error updating Firestore: ', error);
        throw error;
      }
    }
  }
);

// load data from Firestore
export const loadStateFromFirestore = createAsyncThunk(
  'globalState/loadStateFromFirestore',
  async (userId: string, thunkAPI) => {
    try {
      // log chrome sync token
      chrome.storage.sync.get(null, function (Items) {
        console.log(Items);
      });
      // log userId
      console.log('userId: ' + userId);

      const tabDataFromCloud: TabMasterContainer =
        await fetchDataFromFirestore(userId);

      // log data loaded from cloud
      console.log(`from cloud`);
      console.log(tabDataFromCloud);

      const tabDataFromLocalStorage: TabMasterContainer =
        loadFromLocalStorage('tabContainerData');

      // log data loaded from localStorage
      console.log(`from localStorage`);
      console.log(tabDataFromLocalStorage);

      // new user - hey there!
      if (!tabDataFromLocalStorage && !tabDataFromCloud) {
        console.log(`new user - hey there!`);
        thunkAPI.dispatch(setIsDirty());
        thunkAPI.dispatch(syncToFirestore());
      } else if (!tabDataFromLocalStorage) {
        console.log(
          `newly installed returning user - data present only on cloud`
        );
        // newly installed returning user - data present only on cloud
        thunkAPI.dispatch(replaceState(tabDataFromCloud));
        thunkAPI.dispatch(setIsNotDirty());
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(
          setPresentStartup({
            tabContainerDataState: tabDataFromCloud,
          })
        );
      } else if (!tabDataFromCloud) {
        console.log(`data only on localStorage - least likely`);
        // data only on localStorage - least likely
        // local storage has tabData
        // save back to Firestore
        thunkAPI.dispatch(replaceState(tabDataFromLocalStorage));
        thunkAPI.dispatch(setIsDirty());
        thunkAPI.dispatch(syncToFirestore());
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(
          setPresentStartup({
            tabContainerDataState: tabDataFromLocalStorage,
          })
        );
      } else {
        // data present on both local and cloud, possiblity of conflict
        console.log(
          `data present on both local and cloud, possiblity of conflict`
        );
        if (
          tabDataFromLocalStorage!.lastModified !==
          tabDataFromCloud!.lastModified
        ) {
          console.log(`data conflict!`);
          // data conflict!
          thunkAPI.dispatch(
            openConflictModal({
              tabDataLocal: tabDataFromLocalStorage,
              tabDataCloud: tabDataFromCloud,
            })
          );
        }
      }
    } catch (error: any) {
      if (error.message === 'Document does not exist for userId: ' + userId) {
        console.log('handled error: ' + error.message);
        console.log(error);
        thunkAPI.dispatch(setIsDirty());
        thunkAPI.dispatch(syncToFirestore());
      } else if (error.message === `Missing or insufficient permissions.`) {
        console.log('handled error: ' + error.message);
        console.log(error);
        thunkAPI.dispatch(setIsDirty());
        thunkAPI.dispatch(syncToFirestore());
      } else {
        // Handle other types of Firestore errors
        console.log('unexpected error: ' + error.message);
        console.log(error);
        thunkAPI.dispatch(
          showToast({
            toastText: 'Error fetching data:' + error.message,
            duration: 3000,
          })
        );
      }
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
      .addCase(syncToFirestore.pending, (state) => {
        state.syncStatus = 'loading';
      })
      .addCase(syncToFirestore.fulfilled, (state, _) => {
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = 'success';
        } else {
          state.syncStatus = 'error';
        }
      })
      .addCase(syncToFirestore.rejected, (state) => {
        state.syncStatus = 'error';
      })
      .addCase(openSettingsPage.fulfilled, (state) => {
        state.isSettingsPage = true;
      })
      .addCase(showToast.fulfilled, () => {})
      .addCase(loadStateFromFirestore.fulfilled, (state) => {
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = 'success';
        } else {
          state.syncStatus = 'error';
        }
      });
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
  setLoggedOut,
  setUserId,
  removeUserId,
} = globalStateSlice.actions;

export default globalStateSlice.reducer;
