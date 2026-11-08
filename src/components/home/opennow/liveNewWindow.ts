// KAN-949. Which live drags in Currently open are offered the New window boxes.
import type { OpenWindow } from '../../../utils/functions/openNow';
import { withoutSplitFollowers } from '../../../utils/functions/splitPartners';
import { groupIdOfItemId } from '../../../utils/functions/tabGroups';

// Spec Goals 9 and 10a. True when the row, a tab or pair (named by its tab id) or a group (by its item id), has
// company in its window: some listed tab outside it. False for a window's only tab, pair or group, since moving it
// out would only swap one window for another; for the group holding this page (T1: it stays in its window); and
// for a row this snapshot doesn't hold.
export function offersLiveNewWindow(
  rowId: string,
  windows: readonly OpenWindow[],
  pageGroupId: number | null
): boolean {
  const groupId = groupIdOfItemId(rowId);
  for (const window of windows) {
    if (groupId !== undefined) {
      const group = window.groups.find((g) => String(g.id) === groupId);
      if (group === undefined) continue;
      if (group.id === pageGroupId) return false;
      return window.tabs.some((tab) => tab.groupId !== group.id);
    }
    const row = withoutSplitFollowers(window.tabs).find(
      (tab) => String(tab.id) === rowId
    );
    if (row === undefined) continue;
    const pair = window.tabs.filter(
      (tab) =>
        tab.id === row.id ||
        (row.splitViewId !== undefined && tab.splitViewId === row.splitViewId)
    );
    return window.tabs.length > pair.length;
  }
  return false;
}
