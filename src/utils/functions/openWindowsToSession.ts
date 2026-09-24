import { v4 as uuidv4 } from 'uuid';

import { isTabKeeperPage, toStoredTab } from './capture';
import { getStringDate } from './local';
import type { OpenWindow } from './openNow';
import { dropNotificationCount } from './sessionExportHtml';
import { pickNameSourceTab } from './viewMode';
import type {
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// One listed window in storage shape, as toWindowGroupData writes a captured
// one: fresh ids, the first tab's title, and chromeTabGroups only when there
// is a group, so a window without one matches a capture byte for byte.
function toSavedWindow(openWindow: OpenWindow): windowGroupData {
  // Chrome's group ids last only as long as this browser session, so each
  // group gets an id of ours and its tabs point at that.
  const groups = openWindow.groups.map((group) => ({
    groupId: uuidv4(),
    title: group.title,
    color: group.color,
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
      }),
      ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
    };
  });

  const bounds = openWindow.bounds;
  return {
    windowId: uuidv4(),
    windowHeight: bounds?.height ?? 0,
    windowWidth: bounds?.width ?? 0,
    windowOffsetTop: bounds?.top ?? 0,
    windowOffsetLeft: bounds?.left ?? 0,
    tabCount: tabs.length,
    title: dropNotificationCount(openWindow.tabs[0]?.title ?? ''),
    tabs,
    ...(groups.length > 0 ? { chromeTabGroups: groups } : {}),
  };
}

// KAN-280 O13. Open now's snapshot as a saved session: what the pane shows is
// what gets saved. Windows in the order given; Tab Keeper pages were never in
// the snapshot (KAN-300).
export function openWindowsToSession(
  windows: OpenWindow[],
  title: string,
  now: Date
): tabContainerData {
  const saved = windows.map(toSavedWindow);
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
// most recently used tab that is not a Tab Keeper page, cleaned of an unread
// count, else `fallback` -- the caller's t('New Tab Group').
export async function suggestTitleForWindow(
  windowId: number,
  fallback: string
): Promise<string> {
  const tabs = await chrome.tabs.query({ windowId });
  const picked = pickNameSourceTab(tabs, isTabKeeperPage);
  return picked?.title ? dropNotificationCount(picked.title) : fallback;
}
