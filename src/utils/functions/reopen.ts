import { toOpenWindowBounds } from './openNow';
import type { OpenGroup, OpenTab, OpenWindow } from './openNow';

// Close a live tab or window from the Open now pane, and put it back exactly
// with Reopen (KAN-280 O8). DOM-free -- no `window`, no `document` -- so it
// stays usable from the service worker if Reopen ever has to outlive the page.

// What a close leaves behind for Reopen (KAN-280 O8): the snapshot Open now
// held at the moment of closing. Never stored.
export type ClosedItem =
  | { kind: 'window'; window: OpenWindow }
  // `window` is the tab's whole window as it was, so a window that closed
  // with its last tab can be rebuilt in its old place.
  | { kind: 'tab'; tab: OpenTab; group: OpenGroup | null; window: OpenWindow };

// The snapshot with the window's bounds and state as Chrome reports them
// now (KAN-280 rule 5, KAN-308). A move, resize or maximize fires no event
// Open now re-reads on, so the snapshot can hold the window's old place. Read
// before the remove: a tab close can take its window with it. A failed read
// keeps the snapshot's place, and the close still goes ahead.
async function withCurrentPlacement(
  openWindow: OpenWindow
): Promise<OpenWindow> {
  try {
    const current = await chrome.windows.get(openWindow.id);
    return {
      ...openWindow,
      bounds: toOpenWindowBounds(current),
      state: current.state ?? 'normal',
    };
  } catch {
    return openWindow;
  }
}

// Resolves to the ClosedItem when Chrome closed it, or null when it could not
// (the tab or window was already gone). Never rejects.
export async function closeOpenTab(
  openWindow: OpenWindow,
  tab: OpenTab
): Promise<ClosedItem | null> {
  const placed = await withCurrentPlacement(openWindow);
  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    return null;
  }
  return {
    kind: 'tab',
    tab,
    group: openWindow.groups.find((group) => group.id === tab.groupId) ?? null,
    window: placed,
  };
}

export async function closeOpenWindow(
  openWindow: OpenWindow
): Promise<ClosedItem | null> {
  const placed = await withCurrentPlacement(openWindow);
  try {
    await chrome.windows.remove(openWindow.id);
  } catch {
    return null;
  }
  return { kind: 'window', window: placed };
}

// What Reopen brought back, by the new id Chrome gave it: focus goes to its
// row once Open now lists it (KAN-311, O8c). A tab whose window had gone is
// still a tab, in the window made around it.
export type Reopened =
  | { kind: 'tab'; tabId: number }
  | { kind: 'window'; windowId: number };

// Recreates a ClosedItem exactly (KAN-280 O8, rules 5, 6, 7 and 10). Resolves
// to what came back, or null when nothing could. Never rejects.
export async function reopenClosed(item: ClosedItem): Promise<Reopened | null> {
  try {
    if (item.kind === 'tab') return await recreateTab(item);
    const rebuilt = await recreateWindow(item.window);
    return rebuilt && { kind: 'window', windowId: rebuilt.windowId };
  } catch (error) {
    console.warn('Could not reopen: ', error);
    return null;
  }
}

type WindowSnapshot = Pick<
  OpenWindow,
  'bounds' | 'state' | 'incognito' | 'tabs' | 'groups'
>;

// A recreated window, and each tab that came back into it: the new tab id by
// the old one. Never empty: a window nothing came back into is removed.
type RebuiltWindow = {
  windowId: number;
  createdByOldId: ReadonlyMap<number, number>;
};

// Rule 5: the window comes back unfocused, in its old bounds and state.
//
// It is created EMPTY -- Chrome opens a seed chrome://newtab/ tab -- and the
// real tabs are added one by one. A window created with a refused first url
// rejects outright, so passing the urls to windows.create would lose every
// tab to one that Chrome declines (rule 10). The seed goes once the real tabs
// are in.
async function recreateWindow(
  snapshot: WindowSnapshot
): Promise<RebuiltWindow | null> {
  let created: chrome.windows.Window | undefined;
  try {
    created = await chrome.windows.create({
      focused: false,
      incognito: snapshot.incognito,
      ...(snapshot.bounds ?? {}),
    });
  } catch (error) {
    console.warn('Could not reopen a window: ', error);
    return null;
  }
  const windowId = created?.id;
  if (windowId === undefined) return null;
  const seedTabId = created?.tabs?.[0]?.id;

  // Rule 7: each tab loads its real address, never the lazy-load placeholder
  // a session restore uses. One at a time, so `index` is the count so far.
  const createdByOldId = new Map<number, number>();
  for (const tab of snapshot.tabs) {
    try {
      const reopened = await chrome.tabs.create({
        windowId,
        url: tab.url,
        index: createdByOldId.size,
        pinned: tab.pinned,
        active: false,
      });
      if (reopened.id !== undefined) createdByOldId.set(tab.id, reopened.id);
    } catch (error) {
      // Rule 10: a tab Chrome refuses is skipped; the rest still come back.
      console.warn('Could not reopen a tab: ', error);
    }
  }

  const [firstCreatedId] = createdByOldId.values();
  if (firstCreatedId === undefined) {
    // Rule 10: nothing came back, so leave no empty window behind.
    try {
      await chrome.windows.remove(windowId);
    } catch (error) {
      console.warn('Could not remove an empty reopened window: ', error);
    }
    return null;
  }

  const activeTab = snapshot.tabs.find((tab) => tab.active);
  const activeId =
    (activeTab && createdByOldId.get(activeTab.id)) ?? firstCreatedId;
  try {
    await chrome.tabs.update(activeId, { active: true });
  } catch (error) {
    console.warn('Could not activate a reopened tab: ', error);
  }

  // Undefined -- not throwing -- while the tabGroups permission is
  // ungranted, which it may have become since the close (the tabs then come
  // back ungrouped). Grouping runs after activation: the active tab is never
  // in a collapsed group in a real snapshot, and collapsing last keeps it so.
  if (chrome.tabGroups) {
    for (const group of snapshot.groups) {
      const tabIds = snapshot.tabs
        .filter((tab) => tab.groupId === group.id)
        .flatMap((tab) => {
          const newId = createdByOldId.get(tab.id);
          return newId === undefined ? [] : [newId];
        });
      if (tabIds.length === 0) continue;
      try {
        const [firstTabId, ...restTabIds] = tabIds;
        const groupId = await chrome.tabs.group({
          createProperties: { windowId },
          tabIds: [firstTabId, ...restTabIds],
        });
        await chrome.tabGroups.update(groupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed,
        });
      } catch (error) {
        console.warn('Could not reopen a tab group: ', error);
      }
    }
  }

  if (seedTabId !== undefined) {
    try {
      await chrome.tabs.remove(seedTabId);
    } catch (error) {
      console.warn('Could not remove the seed tab: ', error);
    }
  }

  // Last, because windows.create cannot combine `focused: false` with a
  // maximized or fullscreen state. 'locked-fullscreen' needs a kiosk
  // permission this extension does not hold, so it comes back normal.
  if (
    snapshot.state === 'minimized' ||
    snapshot.state === 'maximized' ||
    snapshot.state === 'fullscreen'
  ) {
    try {
      await chrome.windows.update(windowId, { state: snapshot.state });
    } catch (error) {
      console.warn('Could not restore a reopened window state: ', error);
    }
  }

  return { windowId, createdByOldId };
}

// Rule 6: the tab goes back to its window at its Chrome index, pinned or
// not, active or not, and into its group. If the window has gone -- it was
// the window's last tab, say -- the window is recreated around it.
async function recreateTab(
  item: Extract<ClosedItem, { kind: 'tab' }>
): Promise<Reopened | null> {
  try {
    await chrome.windows.get(item.window.id);
  } catch {
    const rebuilt = await recreateWindow({
      ...item.window,
      tabs: [item.tab],
      groups: item.group ? [item.group] : [],
    });
    const tabId = rebuilt?.createdByOldId.get(item.tab.id);
    return tabId === undefined ? null : { kind: 'tab', tabId };
  }

  let reopened: chrome.tabs.Tab;
  try {
    // Created in the background even when it was the front tab: Chrome
    // expands a collapsed group a tab is created into active, and taking the
    // tab back out leaves that group expanded (KAN-280 rule 6, KAN-310). An
    // index past the end is clamped by Chrome.
    reopened = await chrome.tabs.create({
      windowId: item.window.id,
      url: item.tab.url,
      index: item.tab.index,
      pinned: item.tab.pinned,
      active: false,
    });
  } catch (error) {
    console.warn('Could not reopen a tab: ', error);
    return null;
  }
  // Chrome gives every tab it creates an id. Without one there is nothing to
  // group, raise or focus, and no way to tell the tab apart from any other.
  if (reopened.id === undefined) {
    console.warn('Chrome gave a reopened tab no id');
    return null;
  }

  // Undefined while the tabGroups permission is ungranted; the snapshot
  // then could not see groups, so an ungrouped tab is not known to be one.
  if (chrome.tabGroups) {
    if (item.group) {
      await regroup(reopened.id, item.window.id, item.group);
    } else if (reopened.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await leaveGroup(reopened.id);
    }
  }

  // To the front only once it is in its own group or none (KAN-310). This
  // raises it within its window without focusing the window (rule 5). Its
  // own group, if collapsed, expands to show it, as it would in Chrome.
  if (item.tab.active) {
    try {
      await chrome.tabs.update(reopened.id, { active: true });
    } catch (error) {
      console.warn('Could not bring a reopened tab to the front: ', error);
    }
  }
  return { kind: 'tab', tabId: reopened.id };
}

// Chrome puts a tab created strictly between two tabs of one group into that
// group. A tab that was ungrouped when it closed comes back ungrouped
// (KAN-280 rule 6, KAN-309). It is still reopened if this fails, so it only
// warns.
async function leaveGroup(tabId: number): Promise<void> {
  try {
    await chrome.tabs.ungroup(tabId);
  } catch (error) {
    console.warn('Could not take a reopened tab out of a group: ', error);
  }
}

// Joins the old group if it still exists in the tab's window; otherwise makes
// a new one with the old name, colour and collapsed state (rule 6). A tab
// that comes back ungrouped is still reopened, so this only warns.
async function regroup(
  tabId: number,
  windowId: number,
  group: OpenGroup
): Promise<void> {
  try {
    const existing = await chrome.tabGroups.get(group.id).catch(() => null);
    if (existing && existing.windowId === windowId) {
      await chrome.tabs.group({ groupId: group.id, tabIds: [tabId] });
      return;
    }
    const groupId = await chrome.tabs.group({
      createProperties: { windowId },
      tabIds: [tabId],
    });
    await chrome.tabGroups.update(groupId, {
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    });
  } catch (error) {
    console.warn('Could not regroup a reopened tab: ', error);
  }
}
