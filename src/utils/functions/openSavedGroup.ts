import { resolveTabUrl } from './local';
import {
  groupLandingTab,
  switchToOpenTab,
  thisWindowFirst,
  toOpenWindows,
} from './openNow';
import type { OpenTab, OpenWindow } from './openNow';
import { readRecentTabs } from './recentTabs';
import { leaveOutOpenTabs, openCopyOf, openPagesOf } from './skipOpen';
import { applyTabGroups } from './windows';
import type { TabGroupSpec } from './windows';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-885. What a saved group is matched on: its name and its tabs' addresses.
export interface SavedGroupContent {
  title: string;
  urls: readonly string[];
}

// The open group a saved group's Open switches to.
export interface OpenGroupMatch {
  windowId: number;
  tabs: OpenTab[];
}

// Name (exact; colour ignored), tab count, then addresses as a set, each
// compared once lazy-load and suspended wrappers are unwrapped. One string, so
// the button's name and its click cannot disagree.
function groupKey(title: string, urls: readonly string[]): string {
  const addresses = [...new Set(urls.map(resolveTabUrl))].sort();
  return JSON.stringify([title, urls.length, addresses]);
}

// Each live group of a window with its tabs, keyed as groupKey keys a saved one.
function keyedGroups(window: OpenWindow): { key: string; tabs: OpenTab[] }[] {
  return window.groups.map((group) => {
    const tabs = window.tabs.filter((tab) => tab.groupId === group.id);
    return {
      key: groupKey(
        group.title,
        tabs.map((tab) => tab.url)
      ),
      tabs,
    };
  });
}

const lastUsed = (tabs: readonly OpenTab[]) =>
  Math.max(...tabs.map((tab) => tab.lastAccessed ?? -Infinity));

// KAN-885. The open group matching `saved`: Tab Keeper's own window first,
// then the group used last.
export function findOpenGroup(
  saved: SavedGroupContent,
  windows: readonly OpenWindow[]
): OpenGroupMatch | undefined {
  const key = groupKey(saved.title, saved.urls);
  let best: { match: OpenGroupMatch; own: boolean } | undefined;
  for (const window of thisWindowFirst(windows)) {
    for (const group of keyedGroups(window)) {
      if (group.key !== key) continue;
      const own = window.isThisWindow;
      if (
        best === undefined ||
        (own === best.own && lastUsed(group.tabs) > lastUsed(best.match.tabs))
      )
        best = { match: { windowId: window.id, tabs: group.tabs }, own };
    }
  }
  return best?.match;
}

// KAN-885. Every open group's key, for the saved group's button name.
export function openGroupKeys(
  windows: readonly OpenWindow[]
): ReadonlySet<string> {
  return new Set(
    windows.flatMap((window) => keyedGroups(window).map((group) => group.key))
  );
}

// KAN-885. Whether a plain click on the saved group's Open would switch, not open.
export function hasOpenGroup(
  saved: SavedGroupContent,
  keys: ReadonlySet<string>
): boolean {
  return keys.has(groupKey(saved.title, saved.urls));
}

// KAN-885. Switches to the matching open group's last used tab and focuses
// its window. False when none matches, groups cannot be read (no grant), or
// the tab closed before the switch: the caller then opens a copy.
export async function switchToOpenGroup(
  saved: SavedGroupContent
): Promise<boolean> {
  try {
    const [all, groups, self] = await Promise.all([
      chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      chrome.tabGroups.query({}),
      // The window Tab Keeper is in: the tab view's own, or the one behind the popup.
      chrome.windows.getCurrent().catch(() => undefined),
    ]);
    const match = findOpenGroup(
      saved,
      toOpenWindows(all, groups, self?.id ?? null)
    );
    if (match === undefined) return false;
    const recent = (await readRecentTabs([match.windowId]))(match.windowId);
    const landing = groupLandingTab(match.tabs, recent);
    if (landing === undefined) return false;
    await switchToOpenTab(landing);
    return true;
  } catch {
    return false;
  }
}

// The group's Open (KAN-394): its tabs beside the active one, re-grouped, and
// its last tab brought to the front when `active` (KAN-885: behind else).
// KAN-910. `skipTabsAlreadyOpen` leaves out pages the window has; it only
// applies when `active`, so the background copy always opens everything.
//
// The index advances per tab. Creating them all at currentTabIndex + 1 would
// reverse the group, because each insert pushes the previous one right.
export async function openGroupBesideActive(
  tabs: readonly tabData[],
  group: TabGroupSpec | undefined,
  active: boolean,
  skipTabsAlreadyOpen: boolean
): Promise<void> {
  const [current] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!current) return;

  let toOpen = tabs;
  if (active && skipTabsAlreadyOpen) {
    const open = openPagesOf(
      await chrome.tabs.query({ windowId: current.windowId })
    );
    const left = leaveOutOpenTabs(tabs, open);
    toOpen = left.tabs;
    if (toOpen.length === 0) {
      // Everything is here: show the open copy of the last saved tab.
      const last = tabs[tabs.length - 1];
      const copy = last === undefined ? undefined : openCopyOf(last, open);
      if (copy !== undefined) await chrome.tabs.update(copy, { active: true });
      return;
    }
  }

  // Sequential, not Promise.all. Each create is given an explicit index,
  // and concurrent inserts would resolve those indexes against a list that
  // is still shifting -- the group would come out shuffled.
  const created: chrome.tabs.Tab[] = [];
  for (const [offset, tab] of toOpen.entries()) {
    created.push(
      await chrome.tabs.create({
        url: resolveTabUrl(tab.url),
        // Nothing is created focused. Activating a tab DESTROYS the popup,
        // and everything below -- including the grouping -- is a
        // continuation of this handler that would simply never run. The
        // first version created the last tab active and the tabs opened
        // ungrouped in the real popup, while looking correct when driven
        // as a tab, which does not die.
        active: false,
        index: current.index + 1 + offset,
      })
    );
  }

  const tabIds = created
    .map((tab) => tab.id)
    .filter((id): id is number => id !== undefined);
  if (tabIds.length === 0) return;

  // Re-forms the saved group -- same name, same colour -- by reusing the
  // function restore already uses, rather than a second implementation of
  // the same thing. No permission check here: this row only renders when
  // hasTabGroupsPermission is true, and applyTabGroups feature-detects
  // chrome.tabGroups anyway, so a missing namespace leaves the tabs open
  // and ungrouped rather than failing the click.
  if (group !== undefined)
    await applyTabGroups(
      current.windowId,
      [group],
      new Map([[group.groupId, tabIds]])
    );

  // Focus LAST, once the group exists. This is the step that kills the
  // popup, so nothing may depend on running after it.
  if (active)
    await chrome.tabs.update(tabIds[tabIds.length - 1], { active: true });
}
