import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { RootState } from '../store';
import { setPresentStartup } from './undoRedoSlice';
import { selectCategory, SettingsCategory } from './settingsCategoryStateSlice';
import { replaceState, TabMasterContainer } from './tabContainerDataStateSlice';
import {
  loadFromFirestore,
  saveToFirestore,
} from '../../utils/functions/external';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../utils/functions/local';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import { TOAST_MESSAGES } from '../../utils/constants/common';

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
  isRateAndReviewModalOpen: boolean;
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
  isRateAndReviewModalOpen: false,
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
          state.tabContainerDataState
        );
        // Save to localStorage after successful Firestore update
        saveToLocalStorage('tabContainerData', state.tabContainerDataState);
        thunkAPI.dispatch(setIsNotDirty());
      }
    } catch (error: any) {
      console.warn('Error updating Firestore: ', error.message);
      // Reject so the `saveToFirestoreIfDirty.rejected` case sets syncStatus to
      // 'error'. Catching here left the write silently failed while the UI
      // reported success.
      throw error;
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

    // localStorage is user-writable and survives extension updates, so whatever
    // comes back here is genuinely unknown. Validate before the sync can act on
    // it: an invalid container is treated as absent, which falls through to the
    // cloud-only branch below and leaves the intact cloud copy alone.
    const localCandidate = loadFromLocalStorage('tabContainerData');
    const tabDataFromLocalStorage: TabMasterContainer | undefined =
      isValidTabMasterContainer(localCandidate) ? localCandidate : undefined;
    if (localCandidate !== undefined && tabDataFromLocalStorage === undefined) {
      console.warn(
        'Ignoring unreadable tabContainerData in localStorage; using cloud copy.'
      );
    }

    if (tabDataFromCloud && tabDataFromLocalStorage) {
      // Both sides hold data. Merge per session rather than making the user
      // discard one side: the old prompt only appeared when the cloud was
      // newer, while a newer local silently overwrote the cloud, so a whole
      // side was already being dropped without asking in one direction.
      const { merged, changedFromLocal, changedFromCloud } = mergeTabContainers(
        tabDataFromLocalStorage,
        tabDataFromCloud,
        Date.now()
      );

      thunkAPI.dispatch(replaceState(merged));

      if (changedFromCloud) {
        thunkAPI.dispatch(setIsDirty());
        thunkAPI.dispatch(saveToFirestoreIfDirty());
      } else {
        thunkAPI.dispatch(setIsNotDirty());
      }

      if (changedFromLocal) {
        thunkAPI.dispatch(
          showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED, duration: 3000 })
        );
      }

      if (!state.globalState.hasSyncedBefore) {
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(setPresentStartup({ tabContainerDataState: merged }));
      }
      thunkAPI.dispatch(setHasSyncedBefore());
    } else if (tabDataFromCloud) {
      // newly installed returning user - data present only on cloud
      thunkAPI.dispatch(replaceState(tabDataFromCloud!));
      thunkAPI.dispatch(setIsNotDirty());
      thunkAPI.dispatch(setSyncStatus(`success`));
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
      // data only on localStorage
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
      // new user - hey there!
      thunkAPI.dispatch(setIsDirty());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
      thunkAPI.dispatch(setHasSyncedBefore());
    }
  }
);

export const openSettingsPage = createAsyncThunk(
  'global/openSettingsPage',
  async (settingsName: SettingsCategory | undefined, thunkAPI) => {
    if (settingsName) thunkAPI.dispatch(selectCategory(settingsName));
  }
);

interface ShowToastPayload {
  toastText: string;
  duration?: number;
}

let toastTimeout: null | ReturnType<typeof setTimeout> = null;
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
    openRateAndReviewModal: (state) => {
      state.isRateAndReviewModalOpen = true;
    },

    closeRateAndReviewModal: (state) => {
      state.isRateAndReviewModalOpen = false;
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

    setSyncStatus: (
      state,
      action: PayloadAction<'idle' | 'loading' | 'success' | 'error'>
    ) => {
      state.syncStatus = action.payload;
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
      .addCase(saveToFirestoreIfDirty.pending, (state) => {
        state.syncStatus = 'loading';
      })
      .addCase(saveToFirestoreIfDirty.fulfilled, (state) => {
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = 'success';
        } else {
          state.syncStatus = 'idle';
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
  openRateAndReviewModal,
  closeRateAndReviewModal,
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
  setSyncStatus,
  setUserId,
  removeUserId,
} = globalStateSlice.actions;

export default globalStateSlice.reducer;
