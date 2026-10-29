import type { OpenTab, OpenWindow } from './openNow';

// KAN-867. Which copy of an address stays in a live window: the one in
// front, else a pinned one, else one in a group, else the first. Saved
// sessions keep the first only (duplicateTabs.ts): they have no tab in front.
const keepRank = (tab: OpenTab): number =>
  tab.active ? 0 : tab.pinned ? 1 : tab.groupId !== null ? 2 : 3;

// The copies Remove duplicate tabs closes in one window, in strip order. Only
// this window's tabs compete; the address is compared exactly, and a tab with
// none is never a copy (as firstCopyFilter). Open now lists no Tab Keeper page.
export function liveDuplicatesToClose(window: OpenWindow): OpenTab[] {
  const kept = new Map<string, OpenTab>();
  for (const tab of window.tabs) {
    const best = kept.get(tab.url);
    if (best === undefined || keepRank(tab) < keepRank(best))
      kept.set(tab.url, tab);
  }
  return window.tabs.filter(
    (tab) => tab.url !== '' && kept.get(tab.url) !== tab
  );
}

// Every window's own copies, summed: the header's count.
export function countLiveDuplicates(windows: readonly OpenWindow[]): number {
  return windows.reduce((n, w) => n + liveDuplicatesToClose(w).length, 0);
}
