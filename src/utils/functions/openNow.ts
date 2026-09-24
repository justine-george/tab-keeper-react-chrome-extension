import { isTabKeeperPage } from './capture';
import { sanitizeTabGroupColor } from './tabGroups';
import type { TabGroupColor } from './tabGroups';

// What the Open now pane (KAN-280) shows for one open tab. A live read, never
// stored: KAN-280's rule is that live data never enters Redux's persisted
// slices and is never written to localStorage or Firestore.
export interface OpenTab {
  id: number;
  windowId: number;
  title: string; // tab.title, else its address, else ''
  url: string; // tab.url || tab.pendingUrl || ''
  favIconUrl: string; // '' when Chrome has none
  active: boolean;
  pinned: boolean;
  audible: boolean;
  muted: boolean; // tab.mutedInfo?.muted ?? false
  groupId: number | null; // null when ungrouped or groups are not shown
}

export interface OpenGroup {
  id: number;
  title: string;
  color: TabGroupColor; // sanitizeTabGroupColor(group.color)
  collapsed: boolean;
}

export interface OpenWindow {
  id: number;
  isThisWindow: boolean;
  tabs: OpenTab[];
  groups: OpenGroup[]; // only groups with at least one listed tab, in first-tab order
}

// A tab this pane can show: it has a Chrome-assigned id, and it is not a Tab
// Keeper page (KAN-300's rule -- see isTabKeeperPage). Narrowed with a
// predicate rather than a cast, so the type says what was checked.
function isListableTab(
  tab: chrome.tabs.Tab
): tab is chrome.tabs.Tab & { id: number } {
  return typeof tab.id === 'number' && !isTabKeeperPage(tab);
}

function toOpenTab(
  tab: chrome.tabs.Tab & { id: number },
  groupId: number | null
): OpenTab {
  const url = tab.url || tab.pendingUrl || '';
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || url,
    url,
    favIconUrl: tab.favIconUrl || '',
    active: tab.active,
    pinned: tab.pinned,
    audible: tab.audible ?? false,
    muted: tab.mutedInfo?.muted ?? false,
    groupId,
  };
}

// Chrome's windows/tabs/groups, reshaped into what the Open now pane renders.
// Pure: no chrome.* call happens here, so a caller decides when to read and
// this only decides what the read means.
//
// `groups === null` means the tabGroups permission is not held (Global
// Constraints): every tab reports `groupId: null` and every window reports
// `groups: []`, even for a tab that still carries a Chrome group id -- a
// revoked permission must never leave a stale band on screen.
export function toOpenWindows(
  windows: chrome.windows.Window[],
  groups: chrome.tabGroups.TabGroup[] | null,
  thisWindowId: number | null
): OpenWindow[] {
  const groupsById = new Map<number, chrome.tabGroups.TabGroup>(
    (groups ?? []).map((group) => [group.id, group])
  );

  const result: OpenWindow[] = [];

  for (const window of windows) {
    if (typeof window.id !== 'number') continue;
    const windowId = window.id;

    const listableTabs = (window.tabs ?? []).filter(isListableTab);
    if (listableTabs.length === 0) continue;

    const openGroups: OpenGroup[] = [];
    const seenGroupIds = new Set<number>();

    const openTabs = listableTabs.map((tab) => {
      const knownGroup = groupsById.get(tab.groupId);
      const groupId = knownGroup ? knownGroup.id : null;

      if (knownGroup && !seenGroupIds.has(knownGroup.id)) {
        seenGroupIds.add(knownGroup.id);
        openGroups.push({
          id: knownGroup.id,
          title: knownGroup.title ?? '',
          color: sanitizeTabGroupColor(knownGroup.color),
          collapsed: knownGroup.collapsed,
        });
      }

      return toOpenTab(tab, groupId);
    });

    result.push({
      id: windowId,
      isThisWindow: windowId === thisWindowId,
      tabs: openTabs,
      groups: openGroups,
    });
  }

  return result;
}

// Activates a tab and brings its window to the front -- the Open now pane's
// "Switch to tab" action. Two calls because Chrome has no single one:
// tabs.update({active:true}) only raises the tab within its own window, so
// switching from a DIFFERENT window still leaves that window unfocused.
export async function switchToOpenTab(tab: OpenTab): Promise<void> {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}
