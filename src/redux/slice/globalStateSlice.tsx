import { PayloadAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { RootState } from "../store";
import { simulateNetworkDelay } from "../../utils/helperFunctions";

export interface Global {
  isSignedIn: boolean;
  isSettingsPage: boolean;
  syncStatus: "idle" | "loading" | "success" | "error";
}

export const initialState: Global = {
  isSignedIn: false,
  isSettingsPage: false,
  syncStatus: "idle",
};

export const syncWithThunk = createAsyncThunk(
  "global/syncWithThunk",
  async (_, thunkAPI) => {
    const tabContainerData = (thunkAPI.getState() as RootState)
      .tabContainerDataState;
    try {
      // // update a document in Firestore
      // const docRef = firestore.collection("yourCollectionName").doc("yourDocumentId");
      // await docRef.set({ ...tabContainerData }, { merge: true });

      // simulate a network call delay of 2s
      await simulateNetworkDelay(2000);

      console.log(tabContainerData);

      // return data to handle in the fulfilled reducer
      return { status: "success" };
    } catch (error) {
      console.error("Error updating Firestore: ", error);
      throw error;
    }
  }
);

export const globalStateSlice = createSlice({
  name: "globalState",
  initialState,
  reducers: {
    // open settings page
    openSettingsPage: (state) => {
      state.isSettingsPage = !state.isSettingsPage;
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
      .addCase(syncWithThunk.fulfilled, (state, action) => {
        state.syncStatus = "success";
        // Handle data returned from the thunk
        // state.value = action.payload.value;
        console.log(action);
      })
      .addCase(syncWithThunk.rejected, (state) => {
        state.syncStatus = "error";
      });
  },
});

export const { openSettingsPage, setSignedIn, setLoggedOut } =
  globalStateSlice.actions;

export default globalStateSlice.reducer;
