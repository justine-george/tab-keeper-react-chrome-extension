import { v4 as uuidv4 } from 'uuid';

import { isNotANameSource, pickActiveTabIndex, toStoredTab } from './capture';
import { getStringDate, normalizeTitle } from './local';
import type { OpenWindow } from './openNow';
import type { RecentTabsOf } from './recentTabs';
import { dropNotificationCount } from './sessionExportHtml';
import { pickNameSourceTab } from './viewMode';
import type {
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// One listed window in storage shape, as toWindowGroupData writes a captured
// one: fresh ids, unnamed (KAN-394 L4), and chromeTabGroups only when there
// is a group, so a window without one matches a capture's shape.
function toSavedWindow(
  openWindow: OpenWindow,
  recentTabIds: readonly number[]
): windowGroupData {
  // Chrome's group ids last only as long as this browser session, so each
  // group gets an id of ours and its tabs point at that.
  const groups = openWindow.groups.map((group) => ({
    groupId: uuidv4(),
    title: group.title,
    color: group.color,
    // KAN-460. Absent when open, as a capture writes it.
    ...(group.collapsed ? { collapsed: true as const } : {}),
  }));
  const idByChromeId = new Map(
    openWindow.groups.map((group, i) => [group.id, groups[i].groupId])
  );

  const tabs = openWindow.tabs.map((tab) => {
    const chromeGroupId =
      tab.groupId === null ? undefined : idByChromeId.get(tab.groupId);
    return {
      // OpenTab.title is the address when Chrome has no title, where the
      // popup's capture stores ''. Kept: an untitled saved row then reads as
      // its address rather than blank.
      ...toStoredTab({
        favIconUrl: tab.favIconUrl,
        title: tab.title,
        url: tab.url,
        pinned: tab.pinned,
      }),
      ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
    };
  });

  const bounds = openWindow.bounds;
  const activeIndex = pickActiveTabIndex(openWindow.tabs, recentTabIds);
  return {
    windowId: uuidv4(),
    windowHeight: bounds?.height ?? 0,
    windowWidth: bounds?.width ?? 0,
    windowOffsetTop: bounds?.top ?? 0,
    windowOffsetLeft: bounds?.left ?? 0,
    tabCount: tabs.length,
    title: '',
    tabs,
    ...(groups.length > 0 ? { chromeTabGroups: groups } : {}),
    ...(activeIndex === undefined
      ? {}
      : { activeTabId: tabs[activeIndex].tabId }),
  };
}

// KAN-280 O13. Open now's snapshot as a saved session: what the pane shows is
// what gets saved. Windows in the order given; Tab Keeper pages were never in
// the snapshot (KAN-300).
export function openWindowsToSession(
  windows: OpenWindow[],
  title: string,
  now: Date,
  recentTabsOf: RecentTabsOf
): tabContainerData {
  const saved = windows.map((window) =>
    toSavedWindow(window, recentTabsOf(window.id))
  );
  return {
    tabGroupId: uuidv4(),
    title,
    // One `now` for both, for captureOpenWindows's reason.
    createdTime: getStringDate(now),
    createdAt: now.getTime(),
    windowCount: saved.length,
    tabCount: saved.reduce((sum, window) => sum + window.tabCount, 0),
    isAutoSave: false,
    isSelected: true,
    windows: saved,
  };
}

// The session name the tab view would suggest for this window (rule 1): the
// most recently used tab that names something, cleaned of an unread
// count, else `fallback` -- the caller's t('New Tab Group'). Blank is no name,
// as in the name box (KAN-84), and a refused read names nothing: either way
// the save still happens, under `fallback`.
export async function suggestTitleForWindow(
  windowId: number,
  fallback: string
): Promise<string> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {
    return fallback;
  }
  const picked = pickNameSourceTab(tabs, isNotANameSource);
  return normalizeTitle(dropNotificationCount(picked?.title ?? '')) || fallback;
}
