import { PayloadAction, createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import {
  generatePlaceholderURL,
  saveToLocalStorage,
} from '../../utils/helperFunctions';
import { RootState } from '../store';
import { showToast } from './globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

export interface tabData {
  tabId: string; // TODO: use ULID, 48bit timestamp + 80 bits random data: 128bit key
  favicon: string;
  title: string;
  url: string;
}

export interface windowGroupData {
  windowId: string;
  tabCount: number;
  title: string;
  tabs: tabData[];
}

export interface tabContainerData {
  tabGroupId: string;
  title: string;
  createdTime: string;
  windowCount: number;
  tabCount: number;
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

export interface TabMasterContainer {
  // metadata
  lastModified: number;
  selectedTabGroupId: string | null;

  // data
  tabGroups: tabContainerData[];
}

export const initialState: TabMasterContainer = {
  lastModified: Date.now(), // timestamp
  selectedTabGroupId: null,
  tabGroups: [],
};

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const tabData = tabURLMap[tabId];
  if (tabData) {
    chrome.tabs.update(tabId, { url: tabData.url });
    delete tabURLMap[tabId]; // clean up the map entry
  }
});

const tabURLMap: {
  [key: number]: { url: string; title: string; favicon: string };
} = {};

interface openTabsInAWindowParams {
  tabGroupId: string;
  windowId: string;
}

// open all tabs under this section in a single window
export const openTabsInAWindow = createAsyncThunk(
  'global/openTabsInAWindow',
  async (params: openTabsInAWindowParams, thunkAPI) => {
    const state: TabMasterContainer = (thunkAPI.getState() as RootState)
      .tabContainerDataState;

    const tabGroup = state.tabGroups.find(
      (group) => group.tabGroupId === params.tabGroupId
    );

    const windowGroup = tabGroup?.windows.find(
      (window) => window.windowId === params.windowId
    );

    if (!windowGroup) return;

    const { tabs } = windowGroup;
    chrome.windows.create({ url: tabs[0].url }, (newWindow) => {
      tabs.slice(1).forEach((tabInfo) => {
        const placeholder = generatePlaceholderURL(
          tabInfo.title,
          tabInfo.favicon || '/images/favicon.ico',
          tabInfo.url
        );

        chrome.tabs.create(
          {
            windowId: newWindow!.id,
            url: placeholder,
            active: false,
          },
          (tab) => {
            tabURLMap[tab.id!] = {
              url: tabInfo.url,
              title: tabInfo.title,
              favicon: tabInfo.favicon || '/images/favicon.ico',
            };
          }
        );
      });
    });
  }
);

// open all windows under this tab group in separate windows, with corresponding tabs inside
export const openAllTabContainer = createAsyncThunk(
  'global/openAllTabContainer',
  async (tabGroupId: string, thunkAPI) => {
    const state: TabMasterContainer = (thunkAPI.getState() as RootState)
      .tabContainerDataState;
    const tabGroup = state.tabGroups.find(
      (group) => group.tabGroupId === tabGroupId
    );

    if (!tabGroup) return;

    let isFirstWindow = true;

    tabGroup.windows.forEach((windowGroup) => {
      chrome.windows.create(
        {
          url: windowGroup.tabs[0].url, // load only the first tab directly
          focused: isFirstWindow,
        },
        (newWindow) => {
          windowGroup.tabs.slice(1).forEach((tabInfo) => {
            const placeholder = generatePlaceholderURL(
              tabInfo.title,
              tabInfo.favicon || '/images/favicon.ico',
              tabInfo.url
            );

            chrome.tabs.create(
              {
                windowId: newWindow!.id,
                url: placeholder,
                active: false,
              },
              (tab) => {
                tabURLMap[tab.id!] = {
                  url: tabInfo.url,
                  title: tabInfo.title,
                  favicon: tabInfo.favicon || '/images/favicon.ico',
                };
              }
            );
          });
        }
      );
      isFirstWindow = false;
    });
  }
);

// save to tab container and display a toast message
export const saveToTabContainer = createAsyncThunk(
  'global/saveToTabContainer',
  async (tabContainerData: tabContainerData, thunkAPI) => {
    thunkAPI.dispatch(saveToTabContainerInternal(tabContainerData));

    thunkAPI.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.SAVE_TAB_CONTAINER_SUCCESS,
        duration: 3000,
      })
    );
  }
);

// delete tab group by tabGroupId
export const deleteTabContainer = createAsyncThunk(
  'global/deleteTabContainer',
  async (toBeDeletedTabGroupId: string, thunkAPI) => {
    thunkAPI.dispatch(deleteTabContainerInternal(toBeDeletedTabGroupId));

    thunkAPI.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
        duration: 3000,
      })
    );
  }
);

// delete window by (tabGroupId, windowId)
export const deleteWindow = createAsyncThunk(
  'global/deleteWindow',
  async (params: deleteWindowParams, thunkAPI) => {
    thunkAPI.dispatch(deleteWindowInternal(params));

    thunkAPI.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.DELETE_WINDOW_SUCCESS,
        duration: 3000,
      })
    );
  }
);

// delete tab by (tabGroupId, windowId, tabId)
export const deleteTab = createAsyncThunk(
  'global/deleteTab',
  async (params: deleteTabParams, thunkAPI) => {
    thunkAPI.dispatch(deleteTabInternal(params));

    thunkAPI.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.DELETE_TAB_SUCCESS,
        duration: 3000,
      })
    );
  }
);

export const tabContainerDataStateSlice = createSlice({
  name: 'tabContainerDataState',
  initialState,
  reducers: {
    saveToTabContainerInternal: (
      state,
      action: PayloadAction<tabContainerData>
    ) => {
      const newTabGroupId = action.payload.tabGroupId;
      state.tabGroups.unshift(action.payload);
      state.lastModified = Date.now();

      // update localstorage
      saveToLocalStorage('tabContainerData', state);

      // display toast

      // select this tabGroup
      tabContainerDataStateSlice.caseReducers.selectTabContainer(state, {
        payload: newTabGroupId,
      } as PayloadAction<string>);
    },

    // select tab group by tabGroupId
    selectTabContainer: (state, action: PayloadAction<string>) => {
      state.selectedTabGroupId = action.payload;
      state.tabGroups.forEach((tabGroup) => {
        if (tabGroup.tabGroupId === state.selectedTabGroupId) {
          tabGroup.isSelected = true;
        } else {
          tabGroup.isSelected = false;
        }
      });

      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    // delete tab group by tabGroupId
    deleteTabContainerInternal: (state, action: PayloadAction<string>) => {
      const toBeDeletedTabGroupId = action.payload;
      // find the index and delete when id is a match with toBeDeletedId
      const tabGroupIndex = state.tabGroups.findIndex(
        (tabGroup) => tabGroup.tabGroupId === toBeDeletedTabGroupId
      );
      if (tabGroupIndex !== -1) {
        state.tabGroups.splice(tabGroupIndex, 1);
      }
      state.lastModified = Date.now();
      if (state.selectedTabGroupId === toBeDeletedTabGroupId) {
        state.selectedTabGroupId = null;
      }

      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    // delete window by (tabGroupId, windowId)
    deleteWindowInternal: (
      state,
      action: PayloadAction<deleteWindowParams>
    ) => {
      const { tabGroupId, windowId } = action.payload;
      const tabGroupIndex = state.tabGroups.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );
      if (tabGroupIndex !== -1) {
        const windowIndex = state.tabGroups[tabGroupIndex].windows.findIndex(
          (window) => window.windowId === windowId
        );
        if (windowIndex !== -1) {
          // decrement tabGroup's window count by 1
          state.tabGroups[tabGroupIndex].windowCount -= 1;
          // decrement tabGroup's tab count by tab count of the window that's been deleted
          state.tabGroups[tabGroupIndex].tabCount -=
            state.tabGroups[tabGroupIndex].windows[windowIndex].tabCount;

          state.tabGroups[tabGroupIndex].windows.splice(windowIndex, 1);
        }
        // if this was the last window in the tabGroup, delete this tabGroup
        if (state.tabGroups[tabGroupIndex].windowCount === 0) {
          // update selected tab group id
          if (
            state.selectedTabGroupId ===
            state.tabGroups[tabGroupIndex].tabGroupId
          ) {
            state.selectedTabGroupId = null;
          }
          state.tabGroups.splice(tabGroupIndex, 1);
        } else {
          // update tabGroup title, use first window's title
          state.tabGroups[tabGroupIndex].title =
            state.tabGroups[tabGroupIndex].windows[0].title;
        }
      }
      state.lastModified = Date.now();

      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    // delete tab by (tabGroupId, windowId, tabId)
    deleteTabInternal: (state, action: PayloadAction<deleteTabParams>) => {
      const { tabGroupId, windowId, tabId } = action.payload;
      const tabGroupIndex = state.tabGroups.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );
      if (tabGroupIndex !== -1) {
        const windowIndex = state.tabGroups[tabGroupIndex].windows.findIndex(
          (window) => window.windowId === windowId
        );
        if (windowIndex !== -1) {
          const tabIndex = state.tabGroups[tabGroupIndex].windows[
            windowIndex
          ].tabs.findIndex((tab) => tab.tabId === tabId);
          if (tabIndex !== -1) {
            // decrement window's and tabGroup's tab count by 1
            state.tabGroups[tabGroupIndex].windows[windowIndex].tabCount -= 1;
            state.tabGroups[tabGroupIndex].tabCount -= 1;

            state.tabGroups[tabGroupIndex].windows[windowIndex].tabs.splice(
              tabIndex,
              1
            );
          }
          // if this was the last tab in the window, delete this window
          if (
            state.tabGroups[tabGroupIndex].windows[windowIndex].tabCount === 0
          ) {
            // decrement tabGroup's window count by 1
            state.tabGroups[tabGroupIndex].windowCount -= 1;
            // decrement tabGroup's tab count by tab count of the window that's been deleted
            state.tabGroups[tabGroupIndex].tabCount -=
              state.tabGroups[tabGroupIndex].windows[windowIndex].tabCount;

            state.tabGroups[tabGroupIndex].windows.splice(windowIndex, 1);
          } else {
            // update window title, use first tab's title
            state.tabGroups[tabGroupIndex].windows[windowIndex].title =
              state.tabGroups[tabGroupIndex].windows[windowIndex].tabs[0].title;
          }
        }
        // if this was the last window in the tabGroup, delete this tabGroup
        if (state.tabGroups[tabGroupIndex].windowCount === 0) {
          // update selected tab group id
          if (
            state.selectedTabGroupId ===
            state.tabGroups[tabGroupIndex].tabGroupId
          ) {
            state.selectedTabGroupId = null;
          }

          state.tabGroups.splice(tabGroupIndex, 1);
        } else {
          // update tabGroup's title, use first window's title
          state.tabGroups[tabGroupIndex].title =
            state.tabGroups[tabGroupIndex].windows[0].title;
        }
      }
      state.lastModified = Date.now();

      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    replaceState: (state, action: PayloadAction<typeof state>) => {
      // update localstorage
      saveToLocalStorage('tabContainerData', action.payload);
      return action.payload;
    },
  },
});

export const {
  saveToTabContainerInternal,
  selectTabContainer,
  deleteTabContainerInternal,
  deleteWindowInternal,
  deleteTabInternal,
  replaceState,
} = tabContainerDataStateSlice.actions;

export default tabContainerDataStateSlice.reducer;
