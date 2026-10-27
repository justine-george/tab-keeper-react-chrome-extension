import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { customTitleFrom } from './tabTitle';

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

// The tabs that compete, in reading order: windows top to bottom, tabs top to bottom. No scope means the whole session.
function tabsInScope(session: WithWindows, scope?: DuplicateScope): tabData[] {
  return session.windows
    .filter((w) => !scope || w.windowId === scope.windowId)
    .flatMap((w) => w.tabs)
    .filter(
      (t) => scope?.groupId === undefined || t.chromeGroupId === scope.groupId
    );
}

// The tabs Remove duplicate tabs would take out, in reading order.
export function duplicateTabsIn(
  session: WithWindows,
  scope?: DuplicateScope
): tabData[] {
  const isFirst = firstCopyFilter();
  return tabsInScope(session, scope).filter((t) => !isFirst(t));
}

// KAN-824. The name each kept copy takes so a rename is not lost: the first removed copy's, when the kept one has none.
export function namesKeptCopiesTake(
  session: WithWindows,
  scope?: DuplicateScope
): Map<tabData, string> {
  const isFirst = firstCopyFilter();
  const kept = new Map<string, tabData>();
  const names = new Map<tabData, string>();
  for (const t of tabsInScope(session, scope)) {
    if (isFirst(t)) {
      kept.set(t.url, t);
      continue;
    }
    const first = kept.get(t.url);
    if (
      first === undefined ||
      first.customTitle !== undefined ||
      t.customTitle === undefined ||
      names.has(first)
    )
      continue;
    // A name equal to the kept copy's page title is no name (as a rename).
    const name = customTitleFrom(t.customTitle, first.title);
    if (name !== undefined) names.set(first, name);
  }
  return names;
}

export function countDuplicateTabs(
  session: WithWindows,
  scope?: DuplicateScope
): number {
  return duplicateTabsIn(session, scope).length;
}
