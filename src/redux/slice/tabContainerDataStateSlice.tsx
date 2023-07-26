import { PayloadAction, createSlice } from "@reduxjs/toolkit";

import { v4 as uuidv4 } from "uuid";
import { getCurrentDateString } from "../../utils/helperFunctions";

export interface tabData {
  tabId: string; // TODO: use ULID, 48bit timestamp + 80 bits random data: 128bit key
  favicon: string;
  title: string;
  url: string;
}

export interface windowGroupData {
  windowId: string;
  title: string;
  tabs: tabData[];
}

export interface tabContainerData {
  tabGroupId: string;
  title: string;
  createdTime: string; // TODO: conversion to Date might be needed
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

const initialState: tabContainerData[] = [];

export const tabContainerDataStateSlice = createSlice({
  name: "tabContainerData",
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
        title: title,
        createdTime: getCurrentDateString(),
        isAutoSave: false,
        isSelected: true,
        windows: [
          {
            windowId: uuidv4(),
            title: "Youtube - Sample",
            tabs: [
              {
                tabId: uuidv4(),
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
              {
                tabId: uuidv4(),
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
              {
                tabId: uuidv4(),
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
            ],
          },
          {
            windowId: uuidv4(),
            title: "Youtube - Sample",
            tabs: [
              {
                tabId: uuidv4(),
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
              {
                tabId: uuidv4(),
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
              {
                tabId: uuidv4(),
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
            ],
          },
        ],
      };
      state.unshift(dummyValue);

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
          state[tabGroupIndex].windows.splice(windowIndex, 1);
        }
        // if this was the last window in the tabGroup, delete this tabGroup
        if (state[tabGroupIndex].windows.length === 0) {
          state.splice(tabGroupIndex, 1);
        }
      }
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
            state[tabGroupIndex].windows[windowIndex].tabs.splice(tabIndex, 1);
          }
          // if this was the last tab in the window, delete this window
          if (state[tabGroupIndex].windows[windowIndex].tabs.length === 0) {
            state[tabGroupIndex].windows.splice(windowIndex, 1);
          }
        }
        // if this was the last window in the tabGroup, delete this tabGroup
        if (state[tabGroupIndex].windows.length === 0) {
          state.splice(tabGroupIndex, 1);
        }
      }
    },
  },
});

export const {
  saveToTabContainer,
  selectTabContainer,
  deleteTabContainer,
  deleteWindow,
  deleteTab,
} = tabContainerDataStateSlice.actions;

export default tabContainerDataStateSlice.reducer;
