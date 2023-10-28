import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { RootState } from '../store';
import { showToast } from './globalStateSlice';
import {
  decodeDataUrl,
  generatePlaceholderURL,
  saveToLocalStorage,
} from '../../utils/functions/local';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_OFFSET_LEFT,
  DEFAULT_WINDOW_OFFSET_TOP,
  DEFAULT_WINDOW_WIDTH,
  TOAST_MESSAGES,
} from '../../utils/constants/common';
import { SettingsData } from './settingsDataStateSlice';

export interface tabData {
  tabId: string;
  favicon: string;
  title: string;
  url: string;
}

export interface windowGroupData {
  windowId: string;
  windowHeight: number;
  windowWidth: number;
  windowOffsetTop: number;
  windowOffsetLeft: number;
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

export interface TabMasterContainer {
  // metadata
  lastModified: number;
  selectedTabGroupId: string | null;

  // data
  tabGroups: tabContainerData[];
}

export interface addCurrWindowToTabGroupParams {
  tabGroupId: string;
  window: windowGroupData;
}

export interface addCurrTabToWindowParams {
  tabGroupId: string;
  windowId: string;
  tabData: tabData;
}

export interface updateTabGroupTitleParams {
  tabGroupId: string;
  editableTitle: string;
}

export interface updateWindowGroupTitleParams {
  tabGroupId: string;
  windowId: string;
  editableTitle: string;
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

export const initialState: TabMasterContainer = {
  lastModified: Date.now(), // timestamp
  selectedTabGroupId: null,
  tabGroups: [],
};

function setupTabActivationListener(isLazyLoad: boolean) {
  if (!isLazyLoad) return;
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    const tabData = tabURLMap[tabId];
    if (tabData) {
      chrome.tabs.update(tabId, { url: tabData.url });
      delete tabURLMap[tabId];
    }
  });
}

const tabURLMap: {
  [key: number]: { url: string; title: string; favicon: string };
} = {};

interface openTabsInAWindowParams {
  tabGroupId: string;
  windowId: string;
  goToURLText: string;
}

// open all tabs under this section in a single window
export const openTabsInAWindow = createAsyncThunk(
  'global/openTabsInAWindow',
  async (params: openTabsInAWindowParams, thunkAPI) => {
    const state: TabMasterContainer = (thunkAPI.getState() as RootState)
      .tabContainerDataState;

    const settingsDataState: SettingsData = (thunkAPI.getState() as RootState)
      .settingsDataState;

    const tabGroup = state.tabGroups.find(
      (group) => group.tabGroupId === params.tabGroupId
    );

    const windowGroup = tabGroup?.windows.find(
      (window) => window.windowId === params.windowId
    );

    if (!windowGroup) return;

    setupTabActivationListener(settingsDataState.isLazyLoad);

    const { tabs } = windowGroup;
    chrome.windows.create(
      {
        url: tabs[0].url,
        height: windowGroup.windowHeight || DEFAULT_WINDOW_HEIGHT,
        width: windowGroup.windowWidth || DEFAULT_WINDOW_WIDTH,
        top: windowGroup.windowOffsetTop || DEFAULT_WINDOW_OFFSET_TOP,
        left: windowGroup.windowOffsetLeft || DEFAULT_WINDOW_OFFSET_LEFT,
      },
      (newWindow) => {
        tabs.slice(1).forEach((tabInfo) => {
          const decodedUrl = decodeDataUrl(tabInfo.url);
          let placeholder;
          if (settingsDataState.isLazyLoad) {
            placeholder = generatePlaceholderURL(
              tabInfo.title,
              tabInfo.favicon || '/images/favicon.ico',
              decodedUrl,
              params.goToURLText
            );
          }

          chrome.tabs.create(
            {
              windowId: newWindow!.id,
              url: settingsDataState.isLazyLoad ? placeholder : decodedUrl,
              active: false,
            },
            (tab) => {
              if (settingsDataState.isLazyLoad) {
                tabURLMap[tab.id!] = {
                  url: decodedUrl,
                  title: tabInfo.title,
                  favicon: tabInfo.favicon || '/images/favicon.ico',
                };
              }
            }
          );
        });
      }
    );
  }
);

interface openAllTabContainerParams {
  tabGroupId: string;
  goToURLText: string;
}

// open all windows under this tab group in separate windows, with corresponding tabs inside
export const openAllTabContainer = createAsyncThunk(
  'global/openAllTabContainer',
  async (params: openAllTabContainerParams, thunkAPI) => {
    const state: TabMasterContainer = (thunkAPI.getState() as RootState)
      .tabContainerDataState;
    const settingsDataState: SettingsData = (thunkAPI.getState() as RootState)
      .settingsDataState;
    const tabGroup = state.tabGroups.find(
      (group) => group.tabGroupId === params.tabGroupId
    );

    if (!tabGroup) return;

    setupTabActivationListener(settingsDataState.isLazyLoad);

    let isFirstWindow = true;

    tabGroup.windows.forEach((windowGroup) => {
      chrome.windows.create(
        {
          url: windowGroup.tabs[0].url, // load only the first tab directly
          focused: isFirstWindow,
          height: windowGroup.windowHeight || DEFAULT_WINDOW_HEIGHT,
          width: windowGroup.windowWidth || DEFAULT_WINDOW_WIDTH,
          top: windowGroup.windowOffsetTop || DEFAULT_WINDOW_OFFSET_TOP,
          left: windowGroup.windowOffsetLeft || DEFAULT_WINDOW_OFFSET_LEFT,
        },
        (newWindow) => {
          windowGroup.tabs.slice(1).forEach((tabInfo) => {
            const decodedUrl = decodeDataUrl(tabInfo.url);
            let placeholder;
            if (settingsDataState.isLazyLoad) {
              placeholder = generatePlaceholderURL(
                tabInfo.title,
                tabInfo.favicon || '/images/favicon.ico',
                decodedUrl,
                params.goToURLText
              );
            }

            chrome.tabs.create(
              {
                windowId: newWindow!.id,
                url: settingsDataState.isLazyLoad ? placeholder : decodedUrl,
                active: false,
              },
              (tab) => {
                if (settingsDataState.isLazyLoad) {
                  tabURLMap[tab.id!] = {
                    url: decodedUrl,
                    title: tabInfo.title,
                    favicon: tabInfo.favicon || '/images/favicon.ico',
                  };
                }
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

// add current window to the specified tabgroup and display a toast message
export const addCurrWindowToTabGroup = createAsyncThunk(
  'global/saveToTabContainer',
  async (params: addCurrWindowToTabGroupParams, thunkAPI) => {
    thunkAPI.dispatch(addCurrWindowToTabGroupInternal(params));

    thunkAPI.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS,
        duration: 3000,
      })
    );
  }
);

// add current tab to the specified window container and display a toast message
export const addCurrTabToWindow = createAsyncThunk(
  'global/addCurrTabToWindow',
  async (params: addCurrTabToWindowParams, thunkAPI) => {
    thunkAPI.dispatch(addCurrTabToWindowInternal(params));

    thunkAPI.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.ADD_CURR_TAB_TO_WINDOW_SUCCESS,
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
      state.lastModified = Date.now();

      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    addCurrWindowToTabGroupInternal: (
      state,
      action: PayloadAction<addCurrWindowToTabGroupParams>
    ) => {
      const { tabGroupId, window } = action.payload;

      const tabGroupIndex = state.tabGroups.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );

      if (tabGroupIndex !== -1) {
        state.tabGroups[tabGroupIndex].windowCount += 1;
        state.tabGroups[tabGroupIndex].tabCount += window.tabCount;
        state.tabGroups[tabGroupIndex].windows.unshift(window);
      }
      state.lastModified = Date.now();

      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    addCurrTabToWindowInternal: (
      state,
      action: PayloadAction<addCurrTabToWindowParams>
    ) => {
      const { tabGroupId, windowId, tabData: currentTabData } = action.payload;

      const tabGroupIndex = state.tabGroups.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );

      if (tabGroupIndex !== -1) {
        const windowIndex = state.tabGroups[tabGroupIndex].windows.findIndex(
          (window) => window.windowId === windowId
        );
        if (windowIndex !== -1) {
          // increment tab count of tabGroup and windowGroup
          state.tabGroups[tabGroupIndex].tabCount += 1;
          state.tabGroups[tabGroupIndex].windows[windowIndex].tabCount += 1;
          // add to windowGroup
          state.tabGroups[tabGroupIndex].windows[windowIndex].tabs.unshift(
            currentTabData
          );
        }
      }
      state.lastModified = Date.now();

      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    // update tabGroup title
    updateTabGroupTitle: (
      state,
      action: PayloadAction<updateTabGroupTitleParams>
    ) => {
      const { tabGroupId, editableTitle: newTitle } = action.payload;
      const tabGroupIndex = state.tabGroups.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );
      if (tabGroupIndex !== -1) {
        state.tabGroups[tabGroupIndex].title = newTitle;
      }
      state.lastModified = Date.now();
      // update localstorage
      saveToLocalStorage('tabContainerData', state);
    },

    // update window group title
    updateWindowGroupTitle: (
      state,
      action: PayloadAction<updateWindowGroupTitleParams>
    ) => {
      const { tabGroupId, windowId, editableTitle: newTitle } = action.payload;
      const tabGroupIndex = state.tabGroups.findIndex(
        (tabGroup) => tabGroup.tabGroupId === tabGroupId
      );
      if (tabGroupIndex !== -1) {
        const windowIndex = state.tabGroups[tabGroupIndex].windows.findIndex(
          (window) => window.windowId === windowId
        );
        if (windowIndex !== -1) {
          state.tabGroups[tabGroupIndex].windows[windowIndex].title = newTitle;
        }
      }
      state.lastModified = Date.now();
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
  addCurrWindowToTabGroupInternal,
  addCurrTabToWindowInternal,
  updateTabGroupTitle,
  updateWindowGroupTitle,
  deleteTabContainerInternal,
  deleteWindowInternal,
  deleteTabInternal,
  replaceState,
} = tabContainerDataStateSlice.actions;

export default tabContainerDataStateSlice.reducer;
