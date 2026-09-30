// KAN-350. What each saved detail list hands over when its drag leaves the
// pane sideways: the carried item by id, and the card's snapshot of it. One
// function per list, each taking the row id that list's engine knows.
import type { CarryOut } from '../../../redux/carry';
import type { PaneWindows } from './rowDrag/dropRules';
import {
  TAB_GROUP_COLOR_HEX,
  groupIdOfItemId,
  sanitizeTabGroupColor,
} from '../../../utils/functions/tabGroups';
import { resolveFaviconUrl } from '../../../utils/functions/local';

// The `tabs` list: its rows are tab ids.
export function tabCarryOut(pane: PaneWindows, tabId: string): CarryOut | null {
  for (const w of pane.windows) {
    const tab = w.tabs.find((t) => t.tabId === tabId);
    if (tab === undefined) continue;
    return {
      carried: {
        kind: 'tab',
        tabGroupId: pane.tabGroupId,
        windowId: w.windowId,
        tabId,
      },
      card: {
        kind: 'tab',
        title: tab.title,
        faviconUrl: resolveFaviconUrl(tab.favicon, tab.url),
      },
    };
  }
  return null;
}

// The `items` list: its rows are item ids, and only a group's is carried (a
// loose tab is dragged by the `tabs` list).
export function groupCarryOut(
  pane: PaneWindows,
  itemId: string
): CarryOut | null {
  const groupId = groupIdOfItemId(itemId);
  if (groupId === undefined) return null;
  for (const w of pane.windows) {
    const group = w.chromeTabGroups?.find((g) => g.groupId === groupId);
    const tabCount = w.tabs.filter((t) => t.chromeGroupId === groupId).length;
    if (group === undefined || tabCount === 0) continue;
    return {
      carried: {
        kind: 'group',
        tabGroupId: pane.tabGroupId,
        windowId: w.windowId,
        groupId,
      },
      card: {
        kind: 'group',
        title: group.title,
        // Chrome's own colour, the same fixed map the band paints with.
        color: TAB_GROUP_COLOR_HEX[sanitizeTabGroupColor(group.color)],
        tabCount,
      },
    };
  }
  return null;
}

// The windows list: its rows are window ids.
export function windowCarryOut(
  pane: PaneWindows,
  windowId: string
): CarryOut | null {
  const index = pane.windows.findIndex((w) => w.windowId === windowId);
  if (index === -1) return null;
  return {
    carried: { kind: 'window', tabGroupId: pane.tabGroupId, windowId },
    card: {
      kind: 'window',
      windowNumber: index + 1,
      tabCount: pane.windows[index].tabs.length,
    },
  };
}
