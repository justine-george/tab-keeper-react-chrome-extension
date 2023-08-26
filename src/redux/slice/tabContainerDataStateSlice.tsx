import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";
import {
  getCurrentDateString,
  isLotteryWon,
  saveToLocalStorage,
} from "../../utils/helperFunctions";

export interface tabData {
  tabId: string; // TODO: use ULID, 48bit timestamp + 80 bits random data: 128bit key
  favicon: string;
  title: string;
  url: string;
}

export interface windowGroupData {
  windowId: string;
  tabCount: number; // keep track of this count while adding/removing
  title: string;
  tabs: tabData[];
}

export interface tabContainerData {
  tabGroupId: string;
  title: string;
  createdTime: string; // TODO: conversion to Date might be needed
  windowCount: number; // keep track of this count while adding/removing
  tabCount: number; // keep track of this count while adding/removing
  isAutoSave: boolean;
  isSelected: boolean;
  windows: windowGroupData[];
}

export interface deleteWindowParams {
  tabGroupId: string;
  windowId: string;
}

export interface deleteTabParams {
  tabGroupId: string;
  windowId: string;
  tabId: string;
}

export interface openWindowParams {
  tabGroupId: string;
  windowId: string;
}

export const initialState: tabContainerData[] = [];

export const tabContainerDataStateSlice = createSlice({
  name: "tabContainerDataState",
  initialState,
  reducers: {
    // TODO: receive tabContainerData object ready to push to the state
    // saveToTabContainer: (state, action: PayloadAction<tabContainerData>) => {
    //   state.unshift(action.payload);
    // },

    // add new tab group to the container list
    saveToTabContainer: (state, action: PayloadAction<string>) => {
      const title = action.payload;
      const newTabGroupId = uuidv4();
      const dummyValue = {
        tabGroupId: newTabGroupId,
        // TODO: this should be current window -> current tab title
        title: title || "Youtube - Home",
        createdTime: getCurrentDateString(),
        windowCount: 2, // keep track of this count while adding/removing
        tabCount: 7, // keep track of this count while adding/removing
        isAutoSave: isLotteryWon(),
        isSelected: true,
        windows: [
          {
            windowId: uuidv4(),
            tabCount: 4, // keep track of this count while adding/removing
            title: "Youtube - Home",
            tabs: [
              {
                tabId: uuidv4(),
                favicon: "https://www.youtube.com/favicon.ico",
                title: "Youtube - Home",
                url: "https://www.youtube.com/",
              },
              {
                tabId: uuidv4(),
                favicon: "https://firebase.google.com/favicon.ico",
                title: "Choose a data structure | Firestore | Firebase",
                url: "https://firebase.google.com/docs/firestore/manage-data/structure-data",
              },
              {
                tabId: uuidv4(),
                favicon: "https://en.wikipedia.org/favicon.ico",
                title: "Wikipedia",
                url: "https://www.wikipedia.org/",
              },
              {
                tabId: uuidv4(),
                favicon: "https://react.dev/favicon.ico",
                title: "React",
                url: "https://react.dev/",
              },
            ],
          },
          {
            windowId: uuidv4(),
            tabCount: 3, // keep track of this count while adding/removing
            title: "Proton Mail",
            tabs: [
              {
                tabId: uuidv4(),
                favicon: "https://proton.me/favicon.ico",
                title: "Proton Mail",
                url: "https://mail.proton.me/",
              },
              {
                tabId: uuidv4(),
                favicon: "https://musclewiki.com/static//images/favicon.ico",
                title: "MuscleWiki",
                url: "https://musclewiki.com/",
              },
              {
                tabId: uuidv4(),
                favicon: "https://twitter.com/favicon.ico",
                title: "Home / Twitter",
                url: "https://twitter.com/home",
              },
            ],
          },
        ],
      };
      state.unshift(dummyValue);

      // update localstorage
      saveToLocalStorage("tabContainerData", state);

      // select this tabGroup
      tabContainerDataStateSlice.caseReducers.selectTabContainer(state, {
        payload: newTabGroupId,
      } as PayloadAction<string>);
    },

    // select tab group by tabGroupId
    selectTabContainer: (state, action: PayloadAction<string>) => {
      const selectedTabGroupId = action.payload;
      state.forEach((tabGroup) => {
        if (tabGroup.tabGroupId === selectedTabGroupId) {
          tabGroup.isSelected = true;
        } else {
          tabGroup.isSelected = false;
        }
      });

      // update localstorage
      saveToLocalStorage("tabContainerData", state);
    },

    // delete tab group by tabGroupId
    deleteTabContainer: (state, action: PayloadAction<string>) => {
      const toBeDeletedTabGroupId = action.payload;
      // find the index and delete when id is a match with toBeDeletedId
      const tabGroupIndex = state.findIndex(
        (tabGroup) => tabGroup.tabGroupId === toBeDeletedTabGroupId
      );
      if (tabGroupIndex !== -1) {
        state.splice(tabGroupIndex, 1);
      }

      // update localstorage
      saveToLocalStorage("tabContainerData", state);
    },

    // delete window by (tabGroupId, windowId)
    deleteWindow: (state, action: PayloadAction<deleteWindowParams>) => {
      const { tabGroupId, windowId } = action.payload;
      const tabGroupIndex = state.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );
      if (tabGroupIndex !== -1) {
        const windowIndex = state[tabGroupIndex].windows.findIndex(
          (window) => window.windowId === windowId
        );
        if (windowIndex !== -1) {
          // decrement tabGroup's window count by 1
          state[tabGroupIndex].windowCount -= 1;
          // decrement tabGroup's tab count by tab count of the window that's been deleted
          state[tabGroupIndex].tabCount -=
            state[tabGroupIndex].windows[windowIndex].tabCount;

          state[tabGroupIndex].windows.splice(windowIndex, 1);
        }
        // if this was the last window in the tabGroup, delete this tabGroup
        if (state[tabGroupIndex].windowCount === 0) {
          state.splice(tabGroupIndex, 1);
        } else {
          // update tabGroup title, use first window's title
          state[tabGroupIndex].title = state[tabGroupIndex].windows[0].title;
        }
      }

      // update localstorage
      saveToLocalStorage("tabContainerData", state);
    },

    // delete tab by (tabGroupId, windowId, tabId)
    deleteTab: (state, action: PayloadAction<deleteTabParams>) => {
      const { tabGroupId, windowId, tabId } = action.payload;
      const tabGroupIndex = state.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );
      if (tabGroupIndex !== -1) {
        const windowIndex = state[tabGroupIndex].windows.findIndex(
          (window) => window.windowId === windowId
        );
        if (windowIndex !== -1) {
          const tabIndex = state[tabGroupIndex].windows[
            windowIndex
          ].tabs.findIndex((tab) => tab.tabId === tabId);
          if (tabIndex !== -1) {
            // decrement window's and tabGroup's tab count by 1
            state[tabGroupIndex].windows[windowIndex].tabCount -= 1;
            state[tabGroupIndex].tabCount -= 1;

            state[tabGroupIndex].windows[windowIndex].tabs.splice(tabIndex, 1);
          }
          // if this was the last tab in the window, delete this window
          if (state[tabGroupIndex].windows[windowIndex].tabCount === 0) {
            // decrement tabGroup's window count by 1
            state[tabGroupIndex].windowCount -= 1;
            // decrement tabGroup's tab count by tab count of the window that's been deleted
            state[tabGroupIndex].tabCount -=
              state[tabGroupIndex].windows[windowIndex].tabCount;

            state[tabGroupIndex].windows.splice(windowIndex, 1);
          } else {
            // update window title, use first tab's title
            state[tabGroupIndex].windows[windowIndex].title =
              state[tabGroupIndex].windows[windowIndex].tabs[0].title;
          }
        }
        // if this was the last window in the tabGroup, delete this tabGroup
        if (state[tabGroupIndex].windowCount === 0) {
          state.splice(tabGroupIndex, 1);
        } else {
          // update tabGroup's title, use first window's title
          state[tabGroupIndex].title = state[tabGroupIndex].windows[0].title;
        }
      }

      // update localstorage
      saveToLocalStorage("tabContainerData", state);
    },

    // open all windows under this tab group in separate windows, with corresponding tabs inside
    openAllTabContainer: (state, action: PayloadAction<string>) => {
      // TODO
      console.log(state);
      console.log(action);
    },

    // open all tabs under this section in a single window
    openTabsInAWindow: (state, action: PayloadAction<openWindowParams>) => {
      // TODO
      console.log(state);
      console.log(action);
    },

    replaceState: (state, action: PayloadAction<typeof state>) => {
      // update localstorage
      saveToLocalStorage("tabContainerData", action.payload);
      return action.payload;
    },
  },
});

export const {
  saveToTabContainer,
  selectTabContainer,
  deleteTabContainer,
  deleteWindow,
  deleteTab,
  openAllTabContainer,
  openTabsInAWindow,
  replaceState,
} = tabContainerDataStateSlice.actions;

export default tabContainerDataStateSlice.reducer;
