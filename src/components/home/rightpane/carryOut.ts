// KAN-350. What each saved detail list hands over when its drag reaches the
// session list (KAN-352): the carried item by id, and the card's snapshot of it. One
// function per list, each taking the row id that list's engine knows.
import type { CarryOut } from '../../../redux/carry';
import type { PaneWindows } from './rowDrag/dropRules';
import type { ShownSession } from '../../../utils/functions/carriedView';
import {
  TAB_GROUP_COLOR_HEX,
  groupIdOfItemId,
  sanitizeTabGroupColor,
} from '../../../utils/functions/tabGroups';
import { resolveFaviconUrl } from '../../../utils/functions/local';
import { windowNumbers } from '../../../utils/functions/windowLabel';
import { NEW_LAST_WINDOW } from './newWindowTarget';

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

// The windows list: its rows are window ids. Takes the whole windows, not a
// PaneWindows, because the card names a window as its header does: by its
// title, or its number when unnamed (WindowEntryContainer).
export function windowCarryOut(
  pane: ShownSession,
  windowId: string
): CarryOut | null {
  const w = pane.windows.find((x) => x.windowId === windowId);
  const number = windowNumbers(pane.windows, new Set([NEW_LAST_WINDOW])).get(
    windowId
  );
  if (w === undefined || number === undefined) return null;
  return {
    carried: { kind: 'window', tabGroupId: pane.tabGroupId, windowId },
    card: { kind: 'window', title: w.title, number, tabCount: w.tabs.length },
  };
}
