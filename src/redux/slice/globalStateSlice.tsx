import { PayloadAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { RootState } from "../store";
import { selectCategory } from "./settingsCategoryStateSlice";
import { auth, db, fetchDataFromFirestore } from "../../config/firebase";
import { doc, setDoc } from "firebase/firestore";
import {
  loadFromLocalStorage,
  saveToLocalStorage,
} from "../../utils/helperFunctions";
import { TabMasterContainer, replaceState } from "./tabContainerDataStateSlice";
import { setPresentStartup } from "./undoRedoSlice";

export interface Global {
  isSignedIn: boolean;
  userId: string | null;
  isDirty: boolean;
  isSettingsPage: boolean;
  syncStatus: "idle" | "loading" | "success" | "error";
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
  syncStatus: "idle",
  isToastOpen: false,
  toastText: "",
  isConflictModalOpen: false,
  tabDataLocal: null,
  tabDataCloud: null,
};

export const syncWithThunk = createAsyncThunk(
  "global/syncWithThunk",
  async (_, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    console.log("sync with thunk");
    if (!state.globalState.isSignedIn) {
      thunkAPI.dispatch(openSettingsPage("Account"));
    } else if (state.globalState.isDirty) {
      try {
        console.log("updating data cloud firestore");
        await setDoc(doc(db, "tabGroupData", auth.currentUser!.uid), {
          ...state.tabContainerDataState,
        });

        // Save to localStorage after successful Firestore update
        saveToLocalStorage("tabContainerData", state.tabContainerDataState);
        console.log("Saved to localStorage after successful Firestore update!");

        thunkAPI.dispatch(setIsNotDirty());

        return { status: "success" };
      } catch (error) {
        console.error("Error updating Firestore: ", error);
        throw error;
      }
    }
  }
);

// load data from Firestore
export const loadStateFromFirestore = createAsyncThunk(
  "globalState/loadStateFromFirestore",
  async (userId: string, thunkAPI) => {
    try {
      const tabDataFromCloud: TabMasterContainer = await fetchDataFromFirestore(
        userId
      );

      const tabDataFromLocalStorage: TabMasterContainer =
        loadFromLocalStorage("tabContainerData");

      // compare localstorage data and cloud db data
      if (
        tabDataFromLocalStorage!.lastModified !== tabDataFromCloud!.lastModified
      ) {
        if (
          tabDataFromLocalStorage.tabGroups.length > 0 ||
          tabDataFromCloud.tabGroups.length > 0
        ) {
          // if both have some value present, conflict
          if (
            tabDataFromLocalStorage.tabGroups.length > 0 &&
            tabDataFromCloud.tabGroups.length > 0
          ) {
            console.log("2 non-empty");
            thunkAPI.dispatch(
              openConflictModal({
                tabDataLocal: tabDataFromLocalStorage,
                tabDataCloud: tabDataFromCloud,
              })
            );
          } else if (tabDataFromLocalStorage.tabGroups.length > 0) {
            console.log("local non-empty");
            // local storage has tabData
            // save back to firestore
            thunkAPI.dispatch(replaceState(tabDataFromLocalStorage));
            thunkAPI.dispatch(setIsDirty());
            thunkAPI.dispatch(syncWithThunk());
            // reset presentState in the undoRedoState
            thunkAPI.dispatch(
              setPresentStartup({
                tabContainerDataState: tabDataFromLocalStorage,
              })
            );
          } else {
            console.log("cloud non-empty");
            // cloud db has tabData
            thunkAPI.dispatch(replaceState(tabDataFromCloud));
            thunkAPI.dispatch(setIsNotDirty());
            // reset presentState in the undoRedoState
            thunkAPI.dispatch(
              setPresentStartup({
                tabContainerDataState: tabDataFromLocalStorage,
              })
            );
          }
        } else {
          // both are empty
        }
      } else {
        // proceed as normal
        thunkAPI.dispatch(replaceState(tabDataFromCloud));
        thunkAPI.dispatch(setIsNotDirty());

        // reset presentState in the undoRedoState
        thunkAPI.dispatch(
          setPresentStartup({ tabContainerDataState: tabDataFromCloud })
        );
      }
    } catch (error: any) {
      if (error.message === "Document does not exist for userId: " + userId) {
        thunkAPI.dispatch(setIsDirty());
        thunkAPI.dispatch(syncWithThunk());
      }
    }
  }
);

export const openSettingsPage = createAsyncThunk(
  "global/openSettingsPage",
  async (settingsName: string | undefined, thunkAPI) => {
    if (settingsName) thunkAPI.dispatch(selectCategory(settingsName));
  }
);

interface ShowToastPayload {
  toastText: string;
  duration?: number;
}

export const showToast = createAsyncThunk(
  "global/showToast",
  async ({ toastText, duration = 5000 }: ShowToastPayload, thunkAPI) => {
    if (toastText) {
      thunkAPI.dispatch(setToastText(toastText));
      thunkAPI.dispatch(openToast());

      // default to 5000ms
      setTimeout(() => {
        thunkAPI.dispatch(closeToast());
      }, duration);
    }
  }
);

interface ConflictModalPayload {
  tabDataLocal: TabMasterContainer;
  tabDataCloud: TabMasterContainer;
}

export const globalStateSlice = createSlice({
  name: "globalState",
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

    openToast: (state) => {
      state.isToastOpen = true;
    },

    closeToast: (state) => {
      state.isToastOpen = false;
    },

    setToastText: (state, action: PayloadAction<string>) => {
      state.toastText = action.payload;
    },

    backToHome: (state) => {
      state.isSettingsPage = false;
    },

    setIsNotDirty: (state) => {
      state.isDirty = false;
    },

    setIsDirty: (state) => {
      state.isDirty = true;
      state.syncStatus = "idle";
    },

    setSignedIn: (state) => {
      state.isSignedIn = true;
    },

    setLoggedOut: (state) => {
      state.isSignedIn = false;
      state.syncStatus = "idle";
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
      .addCase(syncWithThunk.pending, (state) => {
        state.syncStatus = "loading";
      })
      .addCase(syncWithThunk.fulfilled, (state, _) => {
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = "success";
        } else {
          state.syncStatus = "error";
        }
      })
      .addCase(syncWithThunk.rejected, (state) => {
        state.syncStatus = "error";
      })
      .addCase(openSettingsPage.fulfilled, (state) => {
        state.isSettingsPage = true;
      })
      .addCase(showToast.fulfilled, (_) => {
        // console.log(state);
      })
      .addCase(loadStateFromFirestore.fulfilled, (state) => {
        console.log("load from firestore fulfilled:");
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = "success";
        } else {
          state.syncStatus = "error";
        }
      });
  },
});

export const {
  openConflictModal,
  closeConflictModal,
  openToast,
  closeToast,
  setToastText,
  backToHome,
  setIsDirty,
  setIsNotDirty,
  setSignedIn,
  setLoggedOut,
  setUserId,
  removeUserId,
} = globalStateSlice.actions;

export default globalStateSlice.reducer;
