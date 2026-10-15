// KAN-280 Part F (spec O12c). What Open now hands the carry: the live item converted as Save window converts it (Q1 A), and its card (D1 A).
import type { CarryOut } from '../../../redux/carry';
import { liveItem } from '../../../redux/carriedItem';
import { resolveFaviconUrl } from '../../../utils/functions/local';
import type { OpenWindow } from '../../../utils/functions/openNow';
import { toSavedWindow } from '../../../utils/functions/openWindowsToSession';
import type { RecentTabsOf } from '../../../utils/functions/recentTabs';
import {
  TAB_GROUP_COLOR_HEX,
  groupIdOfItemId,
  sanitizeTabGroupColor,
} from '../../../utils/functions/tabGroups';

// The tabs list: its rows are Chrome tab ids.
export function liveTabCarryOut(
  windows: readonly OpenWindow[],
  rowId: string,
  recentTabsOf: RecentTabsOf
): CarryOut | null {
  for (const w of windows) {
    const i = w.tabs.findIndex((t) => String(t.id) === rowId);
    if (i === -1) continue;
    const window = toSavedWindow(w, recentTabsOf(w.id));
    const tab = window.tabs[i];
    if (tab === undefined) return null;
    return {
      item: liveItem({
        pick: { kind: 'tab', windowId: window.windowId, tabId: tab.tabId },
        window,
        chromeWindowId: w.id,
      }),
      card: {
        kind: 'tab',
        title: tab.title,
        faviconUrl: resolveFaviconUrl(tab.favicon, tab.url),
      },
    };
  }
  return null;
}

// The items list: its rows are item ids, and only a group's is carried.
export function liveGroupCarryOut(
  windows: readonly OpenWindow[],
  itemId: string,
  recentTabsOf: RecentTabsOf
): CarryOut | null {
  const chromeGroupId = groupIdOfItemId(itemId);
  if (chromeGroupId === undefined) return null;
  for (const w of windows) {
    const g = w.groups.findIndex((x) => String(x.id) === chromeGroupId);
    if (g === -1) continue;
    const window = toSavedWindow(w, recentTabsOf(w.id));
    const group = window.chromeTabGroups?.[g];
    if (group === undefined) return null;
    return {
      item: liveItem({
        pick: {
          kind: 'group',
          windowId: window.windowId,
          groupId: group.groupId,
        },
        window,
        chromeWindowId: w.id,
      }),
      card: {
        kind: 'group',
        title: group.title,
        // Chrome's own colour, the same fixed map the band paints with.
        color: TAB_GROUP_COLOR_HEX[sanitizeTabGroupColor(group.color)],
        tabCount: window.tabs.filter((t) => t.chromeGroupId === group.groupId)
          .length,
      },
    };
  }
  return null;
}

// The windows list: its rows are Chrome window ids. Unnamed, so the card names it by Open now's number (windowLabel).
export function liveWindowCarryOut(
  windows: readonly OpenWindow[],
  windowRowId: string,
  numberOf: (w: OpenWindow) => number,
  recentTabsOf: RecentTabsOf
): CarryOut | null {
  const w = windows.find((x) => String(x.id) === windowRowId);
  if (w === undefined) return null;
  const window = toSavedWindow(w, recentTabsOf(w.id));
  return {
    item: liveItem({
      pick: { kind: 'window', windowId: window.windowId },
      window,
      chromeWindowId: w.id,
    }),
    card: {
      kind: 'window',
      title: '',
      number: numberOf(w),
      tabCount: window.tabs.length,
    },
  };
}
