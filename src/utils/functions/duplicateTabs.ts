import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// A session, or just the windows a row knows about: all the count needs.
interface WithWindows {
  windows: readonly Pick<windowGroupData, 'windowId' | 'tabs'>[];
}

// KAN-609. Passes the first tab at each address and fails every later one, in
// the order it is called: one per pass. The address is compared exactly, and a
// tab with none is never a copy.
export function firstCopyFilter(): (tab: tabData) => boolean {
  const seen = new Set<string>();
  return (tab) => {
    if (tab.url === '') return true;
    if (seen.has(tab.url)) return false;
    seen.add(tab.url);
    return true;
  };
}

// KAN-616. One window of a session, or one tab group in that window. Only the tabs inside compete.
export interface DuplicateScope {
  windowId: string;
  groupId?: string;
}

// The tabs Remove duplicate tabs would take out, in reading order: windows top to bottom, tabs top to bottom.
// No scope means the whole session.
export function duplicateTabsIn(
  session: WithWindows,
  scope?: DuplicateScope
): tabData[] {
  const isFirst = firstCopyFilter();
  return session.windows
    .filter((w) => !scope || w.windowId === scope.windowId)
    .flatMap((w) => w.tabs)
    .filter(
      (t) => scope?.groupId === undefined || t.chromeGroupId === scope.groupId
    )
    .filter((t) => !isFirst(t));
}

export function countDuplicateTabs(
  session: WithWindows,
  scope?: DuplicateScope
): number {
  return duplicateTabsIn(session, scope).length;
}
