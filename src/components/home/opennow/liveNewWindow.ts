// KAN-949. Which live drags in Currently open are offered the New window boxes, and what a release on one moves.
import type { NewWindowMove } from '../../../utils/functions/moveToNewWindow';
import type { OpenWindow } from '../../../utils/functions/openNow';
import {
  openSplitPartners,
  withoutSplitFollowers,
} from '../../../utils/functions/splitPartners';
import { groupIdOfItemId } from '../../../utils/functions/tabGroups';

// Spec Goals 9 and 10a. True when the row, a tab or pair (named by its tab id) or a group (by its item id), has
// company in its window: some listed tab outside it. False for a window's only tab, pair or group, since moving it
// out would only swap one window for another; for the group holding this page (T1: it stays in its window); and
// for a row this snapshot doesn't hold.
export function offersLiveNewWindow(
  rowId: string,
  windows: readonly OpenWindow[],
  // String(group id), as the drag tables name it; undefined when this page is in no group.
  pageGroupId: string | undefined
): boolean {
  const groupId = groupIdOfItemId(rowId);
  for (const window of windows) {
    if (groupId !== undefined) {
      const group = window.groups.find((g) => String(g.id) === groupId);
      if (group === undefined) continue;
      if (String(group.id) === pageGroupId) return false;
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

// The move a release of `rowId` on a New window box makes: its tab, its pair in strip order, or its group's tabs
// as Chrome has them now (hidden Tab Keeper pages in it included: they move with it) with the look the list
// shows. Null for a row this snapshot doesn't hold, or when Chrome won't list the group's window.
export async function newWindowMoveFor(
  rowId: string,
  windows: readonly OpenWindow[]
): Promise<NewWindowMove | null> {
  const groupId = groupIdOfItemId(rowId);
  for (const window of windows) {
    if (groupId !== undefined) {
      const group = window.groups.find((g) => String(g.id) === groupId);
      if (group === undefined) continue;
      let strip: chrome.tabs.Tab[];
      try {
        strip = await chrome.tabs.query({ windowId: window.id });
      } catch {
        return null;
      }
      const [head, ...rest] = strip
        .filter((tab) => tab.groupId === group.id)
        .sort((a, b) => a.index - b.index)
        .flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
      if (head === undefined) return null;
      const { title, color, collapsed } = group;
      return {
        kind: 'group',
        tabIds: [head, ...rest],
        look: { title, color, collapsed },
      };
    }
    const tab = window.tabs.find((t) => String(t.id) === rowId);
    if (tab === undefined) continue;
    const partner = openSplitPartners(window.tabs).get(tab.id);
    if (partner === undefined) return { kind: 'tab', tabId: tab.id };
    const [first, second] =
      tab.index < partner.index ? [tab, partner] : [partner, tab];
    return { kind: 'pair', pair: { first: first.id, second: second.id } };
  }
  return null;
}
