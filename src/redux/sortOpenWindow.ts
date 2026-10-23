import { createAsyncThunk } from '@reduxjs/toolkit';

import { showToast } from './slices/globalStateSlice';
import { storeOpenNowDrop } from './openNowMoveUndo';
import type { RootState } from './store';
import { isTabKeeperPage } from '../utils/functions/capture';
import { changedAnyPlace } from '../utils/functions/openNowMoves';
import type {
  GroupLook,
  MovedTab,
  TabPlace,
} from '../utils/functions/openNowMoves';
import {
  applyLiveOrder,
  holdsSplitView,
  liveOrderOf,
  liveSortOrder,
  sameLiveOrder,
} from '../utils/functions/openNowSort';
import { sanitizeTabGroupColor } from '../utils/functions/tabGroups';
import { TOAST_MESSAGES } from '../utils/constants/common';

// KAN-694. Open now's Sort tabs by site, on a real window.

// A window's strip as Chrome has it now, or null when Chrome refuses the read.
// Copied at once: the objects a call resolves with are not promised to stay as they were.
async function readStrip(windowId: number): Promise<chrome.tabs.Tab[] | null> {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.map((tab) => ({ ...tab }));
  } catch {
    return null;
  }
}

// The window's groups' looks by id, read once: a sort moves no tab into or out of a group, so they hold for the after places too.
async function readLooks(
  windowId: number
): Promise<Map<number, GroupLook> | null> {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    return new Map(
      groups.map((group) => [
        group.id,
        {
          title: group.title ?? '',
          color: sanitizeTabGroupColor(group.color),
          collapsed: group.collapsed,
        },
      ])
    );
  } catch {
    return null;
  }
}

function placeOf(
  tab: chrome.tabs.Tab,
  looks: Map<number, GroupLook>
): TabPlace {
  return {
    windowId: tab.windowId,
    index: tab.index,
    groupId: tab.groupId,
    group: looks.get(tab.groupId) ?? null,
  };
}

// Every tab of the window but Tab Keeper pages, before and after, so Undo can rebuild the whole old order and refuses if any has moved since. A tab gone from the window meanwhile is left out.
function sortRecord(
  before: readonly chrome.tabs.Tab[],
  after: readonly chrome.tabs.Tab[],
  looks: Map<number, GroupLook>
): MovedTab[] {
  const afterById = new Map(after.map((tab) => [tab.id, tab]));
  return before.flatMap((tab) => {
    const now = afterById.get(tab.id);
    if (tab.id === undefined || now === undefined || isTabKeeperPage(tab)) {
      return [];
    }
    return [
      {
        tabId: tab.id,
        before: placeOf(tab, looks),
        after: placeOf(now, looks),
      },
    ];
  });
}

// Sorts a live window by site, re-reading it from Chrome first (never Open now's snapshot), and keeps the sort as the drop ⌘Z undoes.
// Does nothing without the tab group grant, in a window with a split view, or when already sorted. A move Chrome refuses part way stops the sort, and what moved is still kept for Undo.
// True when some tab moved and the drop was kept.
export async function sortOpenWindow(
  windowId: number,
  hasTabGroups: boolean
): Promise<boolean> {
  if (!hasTabGroups || !chrome.tabGroups) return false;
  const before = await readStrip(windowId);
  if (before === null || holdsSplitView(before)) return false;
  const order = liveSortOrder(before, isTabKeeperPage);
  const listed = before.filter((tab) => !isTabKeeperPage(tab));
  if (sameLiveOrder(order, liveOrderOf(listed))) return false;
  const looks = await readLooks(windowId);
  if (looks === null) return false;

  // Refused part way or not, what moved is recorded from a fresh read.
  await applyLiveOrder(windowId, order);
  const after = await readStrip(windowId);
  if (after === null) return false;
  const moved = sortRecord(before, after, looks);
  if (!changedAnyPlace(moved)) return false;
  storeOpenNowDrop({ kind: 'sort', moved });
  return true;
}

// The Open now menu's action: sorts, and says so with an Undo for this drop, only when something moved.
export const sortOpenWindowBySite = createAsyncThunk<
  void,
  number,
  { state: RootState }
>('global/sortOpenWindowBySite', async (windowId, thunkAPI) => {
  const { hasTabGroupsPermission } = thunkAPI.getState().globalState;
  if (!(await sortOpenWindow(windowId, hasTabGroupsPermission))) return;
  await thunkAPI.dispatch(
    showToast({
      toastText: TOAST_MESSAGES.TABS_SORTED_BY_SITE,
      offersOpenNowUndo: true,
    })
  );
});
