import { createAsyncThunk } from '@reduxjs/toolkit';

import { showToast } from './slices/globalStateSlice';
import { keepLiveStep, whileMovingTabs } from './undoHistory';
import type { AppDispatch, RootState } from './store';
import { isTabKeeperPage } from '../utils/functions/capture';
import { changedAnyPlace } from '../utils/functions/openNowMoves';
import type {
  GroupLook,
  MovedTab,
  OpenNowDrop,
  TabPlace,
} from '../utils/functions/openNowMoves';
import {
  applyGroupOrder,
  applyGroupSlots,
  applyLiveOrder,
  holdsSplitView,
  liveGroupSortOrder,
  liveOrderOf,
  liveSortOrder,
  sameLiveOrder,
} from '../utils/functions/openNowSort';
import { byName } from '../utils/functions/sortGroupsByName';
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
    pinned: tab.pinned,
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

// Sorts a live window by site, re-reading it from Chrome first (never Open now's snapshot), and returns the sort's record for the undo history.
// Does nothing without the tab group grant, in a window with a split view, or when already sorted. A move Chrome refuses part way stops the sort, and what moved is still recorded.
// Null when no tab moved.
export async function sortOpenWindow(
  windowId: number,
  hasTabGroups: boolean
): Promise<OpenNowDrop | null> {
  if (!hasTabGroups || !chrome.tabGroups) return null;
  const before = await readStrip(windowId);
  if (before === null || holdsSplitView(before)) return null;
  const order = liveSortOrder(before, isTabKeeperPage);
  const listed = before.filter((tab) => !isTabKeeperPage(tab));
  if (sameLiveOrder(order, liveOrderOf(listed))) return null;
  const looks = await readLooks(windowId);
  if (looks === null) return null;

  // Refused part way or not, what moved is recorded from a fresh read.
  await applyLiveOrder(windowId, order);
  const after = await readStrip(windowId);
  if (after === null) return null;
  const moved = sortRecord(before, after, looks);
  if (!changedAnyPlace(moved)) return null;
  return { kind: 'sort', moved };
}

// The Open now menu's action: sorts, keeps the sort as a step in the undo history (KAN-744 R1), and says so with an Undo for that step, only when something moved.
export const sortOpenWindowBySite = createAsyncThunk<
  void,
  number,
  { state: RootState; dispatch: AppDispatch }
>('global/sortOpenWindowBySite', async (windowId, thunkAPI) => {
  const { hasTabGroupsPermission } = thunkAPI.getState().globalState;
  const drop = await whileMovingTabs(() =>
    sortOpenWindow(windowId, hasTabGroupsPermission)
  );
  if (drop === null) return;
  const id = keepLiveStep(thunkAPI.dispatch, drop);
  await thunkAPI.dispatch(
    showToast({
      toastText: TOAST_MESSAGES.TABS_SORTED_BY_SITE,
      liveStepId: id ?? undefined,
    })
  );
});

// KAN-746. As sortOpenWindow, for the tabs inside one group: the rest of the window is not moved or recorded.
// Does nothing without the grant, for a group gone or holding a split view, or when already sorted. Null when no tab moved.
export async function sortOpenGroup(
  windowId: number,
  groupId: number,
  hasTabGroups: boolean
): Promise<OpenNowDrop | null> {
  if (!hasTabGroups || !chrome.tabGroups) return null;
  const before = await readStrip(windowId);
  if (before === null) return null;
  const members = before.filter((tab) => tab.groupId === groupId);
  if (members.length === 0 || holdsSplitView(members)) return null;
  const order = liveGroupSortOrder(before, groupId, isTabKeeperPage);
  const listed = members
    .filter((tab) => !isTabKeeperPage(tab))
    .sort((a, b) => a.index - b.index);
  if (order.every((id, i) => id === listed[i]?.id)) return null;
  const looks = await readLooks(windowId);
  if (looks === null) return null;

  // Refused part way or not, what moved is recorded from a fresh read.
  await applyGroupOrder(windowId, groupId, order);
  const after = await readStrip(windowId);
  if (after === null) return null;
  const moved = sortRecord(members, after, looks);
  if (!changedAnyPlace(moved)) return null;
  return { kind: 'groupSort', moved };
}

// The Open now group menu's action, as sortOpenWindowBySite.
export const sortOpenGroupBySite = createAsyncThunk<
  void,
  { windowId: number; groupId: number },
  { state: RootState; dispatch: AppDispatch }
>('global/sortOpenGroupBySite', async ({ windowId, groupId }, thunkAPI) => {
  const { hasTabGroupsPermission } = thunkAPI.getState().globalState;
  const drop = await whileMovingTabs(() =>
    sortOpenGroup(windowId, groupId, hasTabGroupsPermission)
  );
  if (drop === null) return;
  const id = keepLiveStep(thunkAPI.dispatch, drop);
  await thunkAPI.dispatch(
    showToast({
      toastText: TOAST_MESSAGES.TABS_SORTED_BY_SITE,
      liveStepId: id ?? undefined,
    })
  );
});

// KAN-746 Part 2. Sorts a live window's groups by name, re-reading it from Chrome first, and records every tab but Tab Keeper pages, as sortOpenWindow does.
// Does nothing without the grant, or when the groups are already in name order. Null when no tab moved.
export async function sortOpenGroupsByName(
  windowId: number,
  locale: string,
  hasTabGroups: boolean
): Promise<OpenNowDrop | null> {
  if (!hasTabGroups || !chrome.tabGroups) return null;
  const before = await readStrip(windowId);
  if (before === null) return null;
  const looks = await readLooks(windowId);
  if (looks === null) return null;
  const groups = liveOrderOf(before).rest.flatMap((unit) =>
    unit.kind === 'group' ? [unit.id] : []
  );
  const order = byName(groups, (id) => looks.get(id)?.title ?? '', locale);
  if (order.every((id, i) => id === groups[i])) return null;

  // Refused part way or not, what moved is recorded from a fresh read.
  await applyGroupSlots(windowId, order);
  const after = await readStrip(windowId);
  if (after === null) return null;
  const moved = sortRecord(before, after, looks);
  if (!changedAnyPlace(moved)) return null;
  return { kind: 'groupOrder', moved };
}

// The Open now window menu's Sort groups by name, as sortOpenWindowBySite.
export const sortOpenWindowGroupsByName = createAsyncThunk<
  void,
  { windowId: number; locale: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'global/sortOpenWindowGroupsByName',
  async ({ windowId, locale }, thunkAPI) => {
    const { hasTabGroupsPermission } = thunkAPI.getState().globalState;
    const drop = await whileMovingTabs(() =>
      sortOpenGroupsByName(windowId, locale, hasTabGroupsPermission)
    );
    if (drop === null) return;
    const id = keepLiveStep(thunkAPI.dispatch, drop);
    await thunkAPI.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.GROUPS_SORTED_BY_NAME,
        liveStepId: id ?? undefined,
      })
    );
  }
);
