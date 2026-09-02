import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { RootState } from '../store';
import { closeFocusModal, openFocusModal, showToast } from './globalStateSlice';
import { getStringDate, saveToLocalStorage } from '../../utils/functions/local';
import {
  captureOpenWindows,
  isAlreadySaved,
  type CaptureScope,
} from '../../utils/functions/capture';
import {
  createWindowWithRetries,
  FOCUS_SESSION_MESSAGE,
  FocusSessionRequest,
  WindowSpec,
} from '../../utils/functions/windows';
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
  // Local wall clock at save time, with no offset recorded, so it cannot be
  // compared across timezones. Kept for display of rows written before
  // createdAt existed; createdAt is the field to order and reason on.
  createdTime: string;
  // The instant the session was saved. Optional because every session stored
  // before this change lacks it; readers fall back to reading createdTime as
  // UTC. See createdInstant in mergeTabData.ts.
  createdAt?: number;
  title: string;
  windowCount: number;
  tabCount: number;
  isAutoSave: boolean;
  isSelected: boolean;
  windows: windowGroupData[];
  // Optional because every document written before this change lacks it.
  // Readers fall back to the container's lastModified; see mergeTabData.ts.
  lastModified?: number;
}

// A deleted session has to leave a trace. Merging by tabGroupId alone would
// let the device that still holds a session re-add it on every sync, so the
// user could never delete it from either device.
export interface deletedTabGroup {
  tabGroupId: string;
  deletedAt: number;
}

export interface TabMasterContainer {
  // metadata
  lastModified: number;
  selectedTabGroupId: string | null;

  // data
  tabGroups: tabContainerData[];
  deletedTabGroups?: deletedTabGroup[];
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

// Bounds are resolved here rather than inside createWindowWithRetries because
// the defaults come from `window.screen`, which the service worker that shares
// that helper does not have.
function toWindowSpec(
  windowGroup: windowGroupData,
  focused: boolean
): WindowSpec {
  return {
    tabs: windowGroup.tabs,
    focused,
    bounds: {
      height: windowGroup.windowHeight || DEFAULT_WINDOW_HEIGHT,
      width: windowGroup.windowWidth || DEFAULT_WINDOW_WIDTH,
      top: windowGroup.windowOffsetTop || DEFAULT_WINDOW_OFFSET_TOP,
      left: windowGroup.windowOffsetLeft || DEFAULT_WINDOW_OFFSET_LEFT,
    },
  };
}

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

    createWindowWithRetries(
      toWindowSpec(windowGroup, true),
      params.goToURLText,
      settingsDataState.isLazyLoad,
      2
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

    tabGroup.windows.forEach((windowGroup, index) => {
      createWindowWithRetries(
        toWindowSpec(windowGroup, index === 0),
        params.goToURLText,
        settingsDataState.isLazyLoad,
        2
      );
    });
  }
);

interface focusTabContainerParams {
  tabGroupId: string;
  goToURLText: string;
  saveTitle: string;
}

// Ask to switch to a session. Opens the confirmation unless there is nothing
// to close, in which case switching is indistinguishable from restoring and
// the prompt would be asking about windows that do not exist.
export const requestFocusTabContainer = createAsyncThunk(
  'global/requestFocusTabContainer',
  async (params: focusTabContainerParams, thunkAPI) => {
    const state: TabMasterContainer = (thunkAPI.getState() as RootState)
      .tabContainerDataState;

    const openWindows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ windowTypes: ['normal'] }, (result) =>
        resolve(result)
      )
    );

    if (openWindows.length === 0) {
      thunkAPI.dispatch(focusTabContainer(params));
      return;
    }

    // Worked out here as well as at the moment of switching, because the
    // dialog must not promise a save that will not happen.
    //
    // 'all-windows' is not a default inherited from anywhere: focus mode
    // closes every normal window (background.ts), so it must save every normal
    // window. The save-row scope must never reach this call (KAN-5).
    const captured = await captureOpenWindows(params.saveTitle, 'all-windows');

    // Nothing to capture is a third case, not a kind of "already saved"
    // (KAN-42). Folding it into `willSave === false` made the dialog say "Your
    // open window is already saved. It will be closed." when nothing was ever
    // saved -- a false claim about the user's data from the one dialog whose
    // whole job is telling them what happens to their tabs.
    //
    // Handled before `willSave` exists rather than by widening it to a
    // tri-state: the boolean is then only ever computed when there is
    // something to save, so it cannot mean two things again. Skipping the
    // prompt is the same call the early return above makes -- there is nothing
    // to warn about losing, since every window being closed is empty, and
    // focusTabContainer already no-ops its own save on a null capture.
    if (captured === null) {
      thunkAPI.dispatch(focusTabContainer(params));
      return;
    }

    const willSave = !isAlreadySaved(captured, state.tabGroups);

    thunkAPI.dispatch(
      openFocusModal({
        tabGroupId: params.tabGroupId,
        windowCount: openWindows.length,
        willSave,
      })
    );
  }
);

// Switch to a session: save what is open now, restore the session, then close
// the windows that were open before.
//
// Only the saving half can happen here. chrome.windows.create({focused: true})
// destroys the popup, so anything sequenced after the restore -- above all the
// closing -- would be racing a JS context Chrome has already torn down. The
// worker outlives the popup, so it owns everything from the restore onward.
// Nothing is toasted for the same reason: there would be no popup left to
// show it.
export const focusTabContainer = createAsyncThunk(
  'global/focusTabContainer',
  async (params: focusTabContainerParams, thunkAPI) => {
    const state: TabMasterContainer = (thunkAPI.getState() as RootState)
      .tabContainerDataState;
    const settingsDataState: SettingsData = (thunkAPI.getState() as RootState)
      .settingsDataState;
    const tabGroup = state.tabGroups.find(
      (group) => group.tabGroupId === params.tabGroupId
    );

    thunkAPI.dispatch(closeFocusModal());

    if (!tabGroup) return;

    // Saving comes first, and entirely before the handoff: it is the only
    // thing making this reversible, and it is the last moment the popup is
    // guaranteed to be alive to do it.
    //
    // Unless there is nothing to save. Switching back and forth between two
    // sessions would otherwise mint a near-duplicate on every switch, because
    // the windows being closed are the ones the last switch restored. Saving
    // only genuinely unsaved work keeps the round trip free.
    // 'all-windows' for the same reason as in requestFocusTabContainer above:
    // this is the save that makes closing every window reversible (KAN-5).
    const captured = await captureOpenWindows(params.saveTitle, 'all-windows');
    if (captured && !isAlreadySaved(captured, state.tabGroups)) {
      thunkAPI.dispatch(saveToTabContainerInternal(captured));
    }

    // Unconditional, and after the save rather than inside it: saving selects
    // what it just saved, so the selection has to be handed back -- but the
    // session switched to is the selected one either way, whether or not
    // anything needed saving.
    thunkAPI.dispatch(selectTabContainer(params.tabGroupId));

    const request: FocusSessionRequest = {
      type: FOCUS_SESSION_MESSAGE,
      specs: tabGroup.windows.map((windowGroup, index) =>
        toWindowSpec(windowGroup, index === 0)
      ),
      goToURLText: params.goToURLText,
      isLazyLoad: settingsDataState.isLazyLoad,
    };

    chrome.runtime.sendMessage(request);
  }
);

export interface saveToTabContainerParams {
  container: tabContainerData;
  scope: CaptureScope;
}

// save to tab container and display a toast message
//
// The scope is carried here only to name the action in the toast. It is not
// re-derived from the captured data: a one-window 'all-windows' save is a real
// case (the user has one window open), and reporting it as "current window
// saved" would describe the browser rather than the button they pressed.
export const saveToTabContainer = createAsyncThunk(
  'global/saveToTabContainer',
  async (params: saveToTabContainerParams, thunkAPI) => {
    thunkAPI.dispatch(saveToTabContainerInternal(params.container));

    thunkAPI.dispatch(
      showToast({
        toastText:
          params.scope === 'current-window'
            ? TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS
            : TOAST_MESSAGES.SAVE_ALL_WINDOWS_SUCCESS,
        duration: 3000,
      })
    );
  }
);

// add current window to the specified tabgroup and display a toast message
export const addCurrWindowToTabGroup = createAsyncThunk(
  // Named for what it does. It shared 'global/saveToTabContainer' with the
  // thunk above until KAN-24: harmless, because createAsyncThunk is a factory
  // with no registry and nothing consumed the string, but it showed two
  // different operations under one name in DevTools and would have made the
  // first `addCase(saveToTabContainer.fulfilled, ...)` match this one too.
  'global/addCurrWindowToTabGroup',
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

// Only content changes advance a session's timestamp, because a timestamp is
// what the merge ranks copies by: letting browsing move one would make this
// device's stale copy outrank a real edit on another.
//
// Selection now stamps nothing at all -- neither here nor the container-wide
// timestamp (KAN-58). It used to move the container one, which reached these
// sessions anyway through sessionTimestamp's fallback for any session lacking
// its own; keeping selection out of `touch` only ever confined that to legacy
// data rather than preventing it.
function touch(group: tabContainerData): void {
  group.lastModified = Date.now();
}

// Do two copies of a session carry the same content?
//
// Used by restoreContainer to tell the sessions a restore is reverting from
// the ones it is merely carrying along unchanged (KAN-55).
//
// Written out rather than JSON.stringify-compared because key order is not
// guaranteed to match: an imported container has been through JSON.parse,
// while the live one was built by these reducers. Two equal sessions with
// different key order would compare unequal, and every import would then
// assert every session it contains.
//
// `lastModified` is deliberately excluded. It is the thing the caller is
// deciding whether to rewrite, so including it would make every session that
// had ever been touched look changed.
function sameSessionContent(a: tabContainerData, b: tabContainerData): boolean {
  return (
    a.title === b.title &&
    a.createdTime === b.createdTime &&
    a.createdAt === b.createdAt &&
    a.isAutoSave === b.isAutoSave &&
    a.windowCount === b.windowCount &&
    a.tabCount === b.tabCount &&
    a.windows.length === b.windows.length &&
    a.windows.every((window, i) => sameWindowContent(window, b.windows[i]))
  );
}

// isSelected is not compared: it is per-device view state, not content, and
// the merge already ignores it for the same reason.
function sameWindowContent(a: windowGroupData, b: windowGroupData): boolean {
  return (
    a.windowId === b.windowId &&
    a.title === b.title &&
    a.windowHeight === b.windowHeight &&
    a.windowWidth === b.windowWidth &&
    a.windowOffsetTop === b.windowOffsetTop &&
    a.windowOffsetLeft === b.windowOffsetLeft &&
    a.tabCount === b.tabCount &&
    a.tabs.length === b.tabs.length &&
    a.tabs.every(
      (tab, i) =>
        tab.tabId === b.tabs[i].tabId &&
        tab.title === b.tabs[i].title &&
        tab.url === b.tabs[i].url &&
        tab.favicon === b.tabs[i].favicon
    )
  );
}

// createdTime and createdAt are the same moment in two formats - a local wall
// clock for display, and the instant the merge orders on. They are written
// together, through this, so a reader can never catch them describing
// different moments.
function stampCreated(group: tabContainerData): void {
  const now = new Date();
  group.createdTime = getStringDate(now);
  group.createdAt = now.getTime();
}

// A removed session has to leave a trace, or the device that still holds it
// re-adds it on the next merge and the user can never delete it anywhere.
// Re-deleting an id refreshes its timestamp rather than appending a duplicate.
function bury(state: TabMasterContainer, tabGroupId: string): void {
  const graves = (state.deletedTabGroups ??= []);
  const existing = graves.find((g) => g.tabGroupId === tabGroupId);
  if (existing) {
    existing.deletedAt = Date.now();
  } else {
    graves.push({ tabGroupId, deletedAt: Date.now() });
  }
}

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
      touch(state.tabGroups[0]);
      state.lastModified = Date.now();

      // update localstorage
      saveToLocalStorage('tabContainerData', state);

      // select this tabGroup
      tabContainerDataStateSlice.caseReducers.selectTabContainer(state, {
        payload: newTabGroupId,
      } as PayloadAction<string>);
    },

    // select tab group by tabGroupId
    //
    // Deliberately does NOT stamp `state.lastModified` (KAN-58). Selection is
    // view state, and the container timestamp is the merge's fallback for any
    // session carrying none of its own (sessionTimestamp, mergeTabData.ts) --
    // so advancing it here made this device's stale copies of those sessions
    // outrank another device's real edits, and fed `signature()` a difference
    // that forced a write. Still persisted to localStorage: the selection has
    // to survive a reload, it just must not look like an edit.
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
        stampCreated(state.tabGroups[tabGroupIndex]);
        state.tabGroups[tabGroupIndex].windows.unshift(window);
        touch(state.tabGroups[tabGroupIndex]);
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
          stampCreated(state.tabGroups[tabGroupIndex]);
          state.tabGroups[tabGroupIndex].windows[windowIndex].tabCount += 1;
          // add to windowGroup
          state.tabGroups[tabGroupIndex].windows[windowIndex].tabs.unshift(
            currentTabData
          );
          touch(state.tabGroups[tabGroupIndex]);
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
        touch(state.tabGroups[tabGroupIndex]);
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
          touch(state.tabGroups[tabGroupIndex]);
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
        bury(state, toBeDeletedTabGroupId);
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
          stampCreated(state.tabGroups[tabGroupIndex]);
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
          // Emptying a group removes it just as surely as deleting it, so it
          // needs the same tombstone or the other device re-adds it.
          bury(state, state.tabGroups[tabGroupIndex].tabGroupId);
          state.tabGroups.splice(tabGroupIndex, 1);
        } else {
          touch(state.tabGroups[tabGroupIndex]);
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
            stampCreated(state.tabGroups[tabGroupIndex]);

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

          // Same cascade as deleteWindowInternal: the group is gone, so it
          // needs a tombstone rather than just a new timestamp.
          bury(state, state.tabGroups[tabGroupIndex].tabGroupId);
          state.tabGroups.splice(tabGroupIndex, 1);
        } else {
          touch(state.tabGroups[tabGroupIndex]);
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

    // Replace the container with one the user is explicitly asserting: an
    // undo/redo snapshot, or an imported backup file. Kept separate from
    // replaceState, which the sync uses for merged results and must not touch
    // timestamps.
    //
    // Either source can bring back a session that has since been deleted, and
    // neither carries a tombstone for it - but the cloud may still hold the one
    // that delete pushed up, and it is newer than the restored session's
    // untouched timestamp. Without help the next merge simply re-applies the
    // delete: the undo or the import appears to work and then silently reverses
    // itself, with no way to recover the session.
    //
    // Stamping the restored session now is not a workaround: bringing it back
    // IS a change to that session, made on this device at this moment, which is
    // exactly what the per-session timestamp records. Only sessions whose
    // tombstone is being withdrawn are stamped - anything else in the payload
    // keeps its own history.
    restoreContainer: (state, action: PayloadAction<typeof state>) => {
      const withdrawnAt = new Map(
        (state.deletedTabGroups ?? []).map((grave) => [
          grave.tabGroupId,
          grave.deletedAt,
        ])
      );
      // The mirror direction: a payload can also re-introduce a tombstone for a
      // session that is currently live - redoing a delete after undoing it. The
      // restored tombstone carries the original delete time, which the undo
      // above has already stamped the session past, so without this the redo
      // silently fails to delete anything.
      const liveAt = new Map(
        state.tabGroups.map((tabGroup) => [
          tabGroup.tabGroupId,
          tabGroup.lastModified ?? state.lastModified,
        ])
      );
      // KAN-55. The live copy of each session, to tell the sessions this
      // restore actually changes from the ones it is merely carrying along.
      const liveGroup = new Map(
        state.tabGroups.map((tabGroup) => [tabGroup.tabGroupId, tabGroup])
      );

      const restored: TabMasterContainer = {
        ...action.payload,
        tabGroups: action.payload.tabGroups.map((tabGroup) => {
          const current = liveGroup.get(tabGroup.tabGroupId);

          // KAN-55. The second thing a restore may have to outrank, alongside
          // a tombstone: a live session whose content this restore is
          // reverting. The merge resolves each session by its own
          // `lastModified` with cloud winning ties, so handing a reverted
          // session back with its snapshot timestamp let the cloud copy --
          // which still holds the edit -- win the next merge. The undo applied
          // locally and sync silently put the edit back.
          //
          // Compared by content, not by timestamp. `touch()` does advance a
          // session's timestamp on every content change, but two edits inside
          // the same millisecond are indistinguishable by it, which is not
          // hypothetical: saving and renaming in quick succession produces
          // exactly that, and the timestamp version of this check passed or
          // failed depending on where a millisecond boundary happened to fall.
          //
          // Only sessions that actually differ are stamped. Bumping every
          // restored session would make an undo assert the whole container,
          // overwriting edits made on another device to sessions the user
          // never touched here.
          const supersededAt =
            current !== undefined && !sameSessionContent(current, tabGroup)
              ? liveAt.get(tabGroup.tabGroupId)
              : undefined;

          const mustOutrank = [
            withdrawnAt.get(tabGroup.tabGroupId),
            supersededAt,
          ].filter((at): at is number => at !== undefined);

          // Neither buried nor superseded: this restore is not changing this
          // session, so leave its timestamp exactly as it was.
          if (mustOutrank.length === 0) return tabGroup;

          return {
            ...tabGroup,
            // Strictly after whatever it must beat, not merely Date.now().
            // Undoing promptly enough lands in the same millisecond, and the
            // merge gives exact ties to cloud - so an equal timestamp loses to
            // the very tombstone or edit this is superseding. The undo
            // happened after the thing it undoes by definition; encode that
            // rather than trusting clock granularity.
            lastModified: Math.max(Date.now(), Math.max(...mustOutrank) + 1),
          };
        }),
        // `?? []` before the map, not `?.map`. The optional call yields
        // undefined for a payload with no tombstones - a backup exported before
        // they existed - but the key is still written, and an explicit
        // `deletedTabGroups: undefined` is not the same as an absent key.
        // JSON.stringify erases that difference; Firestore does not. setDoc
        // walks own enumerable properties and rejects undefined values, so the
        // next cloud write failed with "Unsupported field value: undefined"
        // (KAN-48).
        deletedTabGroups: (action.payload.deletedTabGroups ?? []).map(
          (grave) => {
            const aliveAt = liveAt.get(grave.tabGroupId);
            if (aliveAt === undefined) return grave;
            // Same reasoning, other way round.
            return { ...grave, deletedAt: Math.max(Date.now(), aliveAt + 1) };
          }
        ),
      };

      // update localstorage
      saveToLocalStorage('tabContainerData', restored);
      return restored;
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
  restoreContainer,
} = tabContainerDataStateSlice.actions;

export default tabContainerDataStateSlice.reducer;
