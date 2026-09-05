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
  bytesToMB,
  estimateFirestoreBytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  isValidTabMasterContainer,
  loadFromLocalStorage,
  saveToLocalStorage,
  SYNC_SIZE_REFUSAL,
  TranslatableError,
} from '../../utils/functions/local';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import { TOAST_MESSAGES } from '../../utils/constants/common';

export interface Global {
  hasSyncedBefore: boolean;
  // "a usable document id exists in chrome.storage.sync". A LOCAL read: no
  // network, no authentication. This app has no accounts - sync identity is a
  // client uuid - so "signed in" genuinely means "has a sync identity", and it
  // is what the settings pane renders LoggedIn/NotLoggedIn from.
  //
  // It is NOT permission to call Firestore. See isFirebaseAuthed (KAN-70).
  isSignedIn: boolean;
  // "Firebase anonymous auth has landed", i.e. request.auth is non-null and the
  // security rules will accept a request. Written ONLY by onAuthStateChanged.
  //
  // Separate from isSignedIn because the two resolve at different times: the
  // chrome.storage.sync read returns in milliseconds, the sign-in is a network
  // round trip. Gating on isSignedIn alone opened the gate ~500ms early and
  // every request in that window was denied by the rules.
  isFirebaseAuthed: boolean;
  userId: string | null;
  isDirty: boolean;
  isSettingsPage: boolean;
  isSearchPanel: boolean;
  searchInputText: string;
  syncStatus: 'idle' | 'loading' | 'success' | 'error';
  isToastOpen: boolean;
  // An i18n KEY, not a display string -- Toast renders t(toastText). Every
  // fixed message in TOAST_MESSAGES is an English sentence used as its own
  // key, which is why that reads as if it were already the text.
  toastText: string;
  // Interpolation values for the key above, when it takes any (KAN-86).
  //
  // This exists because a toast built by string concatenation can never be
  // translated: the composed result matches no key, so t() hands it straight
  // back and the user sees English whatever their language. Slices dispatch a
  // key plus its values and Toast does the interpolation, which keeps the
  // existing division of labour -- nothing outside the component tree calls
  // t(), because nothing outside it has a `t` to call.
  toastParams?: Record<string, string | number>;
  isRateAndReviewModalOpen: boolean;
  // KAN-74. How many live tab groups the "turn on tab group support?" offer is
  // about, or null when the offer is not showing. One field rather than an
  // open flag beside a count, so an open prompt without a count is
  // unrepresentable -- the same shape, and for the same reason, as
  // focusRequest below.
  //
  // Session-only, like every other flag here: whether the offer is SHOWING is
  // a fact about this popup, while whether it may be shown AGAIN is persisted
  // in settingsData.
  tabGroupsPromptCount: number | null;
  focusRequest: FocusRequest | null;
  // "the tabGroups permission is granted right now". Mirrors
  // chrome.permissions.contains(), re-read on every popup mount and updated by
  // the permission change listeners -- never persisted, because the user can
  // revoke it from chrome://extensions while the extension is not running.
  hasTabGroupsPermission: boolean;
}

// The session a pending "switch to this session?" confirmation is about, how
// many windows it would close, and whether closing them would save anything
// first -- it does not when those windows are already stored as a session, and
// the dialog has to say which of the two is about to happen. Null when no
// confirmation is open, so the fields can never disagree about whether there
// is something to confirm.
export interface FocusRequest {
  tabGroupId: string;
  windowCount: number;
  willSave: boolean;
}

export const initialState: Global = {
  hasSyncedBefore: false,
  isSignedIn: false,
  isFirebaseAuthed: false,
  userId: null,
  isDirty: false,
  isSettingsPage: false,
  isSearchPanel: false,
  searchInputText: '',
  syncStatus: 'idle',
  isToastOpen: false,
  toastText: '',
  isRateAndReviewModalOpen: false,
  tabGroupsPromptCount: null,
  focusRequest: null,
  hasTabGroupsPermission: false,
};

// save data to Firestore if dirty, saves latest to localStorage at the end
export const saveToFirestoreIfDirty = createAsyncThunk(
  'global/saveToFirestoreIfDirty',
  async (_, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;

    try {
      if (state.globalState.isDirty) {
        // Firestore rejects an over-limit document, and the rejection leaves
        // isDirty set, so every later change retries the same doomed write and
        // sync wedges with nothing on screen to explain it. readImportedContainer
        // already refuses this on the import path; this is the same refusal on
        // the sync path, phrased the same way.
        const bytes = estimateFirestoreBytes(state.tabContainerDataState);
        if (bytes > FIRESTORE_MAX_DOCUMENT_BYTES) {
          // A key plus its values, not a composed sentence: this used to be
          // built by concatenation, which matched no key and so reached every
          // locale in English (KAN-86). The numbers travel as params and Toast
          // interpolates them.
          const params = {
            used: bytesToMB(bytes),
            limit: bytesToMB(FIRESTORE_MAX_DOCUMENT_BYTES),
          };
          thunkAPI.dispatch(
            showToast({
              toastText: SYNC_SIZE_REFUSAL,
              toastParams: params,
              duration: 6000,
            })
          );
          // The rejection reason stays the key. Nothing renders it -- the
          // toast above is the whole user-facing report -- and it is what the
          // requestStatus consumers already treat as opaque.
          throw new TranslatableError(SYNC_SIZE_REFUSAL, params);
        }

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
    const cloudCandidate = await loadFromFirestore(
      state.globalState.userId!,
      thunkAPI
    );

    // The cloud side gets the same treatment localStorage gets below. Without
    // this, an unrecognised document reaches mergeTabContainers and throws
    // `side.tabGroups is not iterable`, rejecting the thunk with no message.
    //
    // Unreadable is deliberately NOT treated as absent. "Absent" falls through
    // to the local-only branch, which writes local state over the document -
    // and a document we failed to parse may be a NEWER FORMAT rather than
    // corruption, so overwriting would destroy data we merely could not read.
    // Stop instead: keep local data, leave the document untouched, report it.
    if (
      cloudCandidate !== undefined &&
      !isValidTabMasterContainer(cloudCandidate)
    ) {
      console.warn(
        'Unreadable Firestore document for this user; leaving it untouched.'
      );
      thunkAPI.dispatch(setSyncStatus('error'));
      // The glyph alone says "something is wrong" without saying what, or
      // whether the sessions on this device survived it (KAN-72).
      thunkAPI.dispatch(
        showToast({
          toastText: TOAST_MESSAGES.UNREADABLE_CLOUD_DOCUMENT,
          duration: 6000,
        })
      );
      return;
    }
    const tabDataFromCloud: TabMasterContainer | undefined = cloudCandidate;

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
        thunkAPI.dispatch(setIsDirtyWithoutSync());
        // saveToFirestoreIfDirty's own fulfilled reducer reports the success.
        thunkAPI.dispatch(saveToFirestoreIfDirty());
      } else {
        // Nothing to write, which is the MOST in-sync a user can be and the
        // usual outcome of opening the popup. It has to say so: syncStatus is
        // what the header icon reads, and leaving it at the initial 'idle'
        // showed the actionable "sync now" icon on a session just confirmed up
        // to date (KAN-79).
        //
        // `setIsNotDirty` alone is not enough, and deriving the icon from
        // isDirty instead would not work either: globalState is rebuilt on
        // every popup open, so `isDirty === false` means "no edits yet this
        // session", not "the two sides agree". Only a completed sync knows
        // that, so only a completed sync may claim it.
        thunkAPI.dispatch(setIsNotDirty());
        thunkAPI.dispatch(setSyncStatus('success'));
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
      thunkAPI.dispatch(setIsDirtyWithoutSync());
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
      thunkAPI.dispatch(setIsDirtyWithoutSync());
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
  toastParams?: Record<string, string | number>;
  duration?: number;
}

let toastTimeout: null | ReturnType<typeof setTimeout> = null;
export const showToast = createAsyncThunk(
  'global/showToast',
  async (
    { toastText, toastParams, duration = 5000 }: ShowToastPayload,
    thunkAPI
  ) => {
    if (toastText) {
      // If there's an existing toast timeout, clear it
      if (toastTimeout !== null) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
      }

      thunkAPI.dispatch(setToastText({ text: toastText, params: toastParams }));
      thunkAPI.dispatch(openToast());

      // Set the new timeout for the current toast
      toastTimeout = setTimeout(() => {
        thunkAPI.dispatch(closeToast());
      }, duration);
    }
  }
);

function markDirty(state: Global): void {
  state.isDirty = true;
  state.syncStatus = 'idle';
}

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

    openTabGroupsPrompt: (state, action: PayloadAction<number>) => {
      state.tabGroupsPromptCount = action.payload;
    },

    closeTabGroupsPrompt: (state) => {
      state.tabGroupsPromptCount = null;
    },

    openFocusModal: (state, action: PayloadAction<FocusRequest>) => {
      state.focusRequest = action.payload;
    },

    closeFocusModal: (state) => {
      state.focusRequest = null;
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

    // params is overwritten on every toast, never merged: leaving a previous
    // toast's values behind would let a key silently interpolate numbers from
    // an unrelated message.
    setToastText: (
      state,
      action: PayloadAction<{
        text: string;
        params?: Record<string, string | number>;
      }>
    ) => {
      state.toastText = action.payload.text;
      state.toastParams = action.payload.params;
    },

    closeSettingsPage: (state) => {
      state.isSettingsPage = false;
    },

    setIsNotDirty: (state) => {
      state.isDirty = false;
    },

    // "The user changed something." customMiddleware watches for this action
    // and schedules a debounced sync, so it must only be dispatched from
    // outside a sync.
    setIsDirty: (state) => {
      markDirty(state);
    },

    // The same flag, deliberately a different action type.
    //
    // The three branches of syncStateWithFirestore that persist something all
    // need isDirty set, because that is what saveToFirestoreIfDirty checks -
    // but they run *inside* a sync. Dispatching setIsDirty there makes the
    // middleware schedule another full sync, so every write costs an extra
    // round trip, and any state the two sides keep disagreeing on becomes an
    // unbounded write loop.
    setIsDirtyWithoutSync: (state) => {
      markDirty(state);
    },

    setSignedIn: (state) => {
      state.isSignedIn = true;
    },

    // Dispatched only by observeAuthState. Deliberately does not touch
    // isSignedIn: conflating the two is the defect these exist to separate.
    setFirebaseAuthed: (state) => {
      state.isFirebaseAuthed = true;
    },

    setFirebaseUnauthed: (state) => {
      state.isFirebaseAuthed = false;
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

    setHasTabGroupsPermission: (state, action: PayloadAction<boolean>) => {
      state.hasTabGroupsPermission = action.payload;
    },
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
  openTabGroupsPrompt,
  closeTabGroupsPrompt,
  openFocusModal,
  closeFocusModal,
  openSearchPanel,
  closeSearchPanel,
  setSearchInputText,
  openToast,
  closeToast,
  setToastText,
  closeSettingsPage,
  setIsDirty,
  setIsDirtyWithoutSync,
  setIsNotDirty,
  setSignedIn,
  setFirebaseAuthed,
  setFirebaseUnauthed,
  setHasSyncedBefore,
  setLoggedOut,
  setSyncStatus,
  setUserId,
  removeUserId,
  setHasTabGroupsPermission,
} = globalStateSlice.actions;

export default globalStateSlice.reducer;
