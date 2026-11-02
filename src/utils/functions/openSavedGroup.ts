import { resolveTabUrl } from './local';
import {
  groupLandingTab,
  switchToOpenTab,
  thisWindowFirst,
  toOpenWindows,
} from './openNow';
import type { OpenTab, OpenWindow } from './openNow';
import { readRecentTabs } from './recentTabs';

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
