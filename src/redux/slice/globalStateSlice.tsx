import { PayloadAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { RootState } from "../store";
import { selectCategory } from "./settingsCategoryStateSlice";
import { auth, db } from "../../config/firebase";
import { doc, setDoc } from "firebase/firestore";

export interface Global {
  isSignedIn: boolean;
  isDirty: boolean;
  isSettingsPage: boolean;
  syncStatus: "idle" | "loading" | "success" | "error";
  isToastOpen: boolean;
  toastText: string;
}

export const initialState: Global = {
  isSignedIn: false,
  isDirty: false,
  isSettingsPage: false,
  syncStatus: "error",
  isToastOpen: false,
  toastText: "",
};

export const syncWithThunk = createAsyncThunk(
  "global/syncWithThunk",
  async (_, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;

    if (!state.globalState.isSignedIn) {
      thunkAPI.dispatch(openSettingsPage("Account"));
    } else if (state.globalState.isDirty) {
      try {
        console.log("updating data cloud firestore");
        await setDoc(doc(db, "tabGroupData", auth.currentUser!.uid), {
          ...state.tabContainerDataState,
        });

        thunkAPI.dispatch(setIsNotDirty());

        return { status: "success" };
      } catch (error) {
        console.error("Error updating Firestore: ", error);
        throw error;
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

export const globalStateSlice = createSlice({
  name: "globalState",
  initialState,
  reducers: {
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
      state.syncStatus = "error";
    },

    setSignedIn: (state) => {
      state.isSignedIn = true;
    },

    setLoggedOut: (state) => {
      state.isSignedIn = false;
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
        // Handle data returned from the thunk
        // state.value = action.payload.value;
        // console.log(action);
      })
      .addCase(syncWithThunk.rejected, (state) => {
        state.syncStatus = "error";
      })
      .addCase(openSettingsPage.fulfilled, (state) => {
        state.isSettingsPage = true;
      })
      .addCase(showToast.fulfilled, (_) => {
        // console.log(state);
      });
  },
});

export const {
  openToast,
  closeToast,
  setToastText,
  backToHome,
  setIsDirty,
  setIsNotDirty,
  setSignedIn,
  setLoggedOut,
} = globalStateSlice.actions;

export default globalStateSlice.reducer;
