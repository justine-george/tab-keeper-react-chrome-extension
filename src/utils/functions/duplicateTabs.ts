import type {
  tabContainerData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

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

// The tabs Remove duplicate tabs would take out, in reading order: windows top to bottom, tabs top to bottom.
export function countDuplicateTabs(
  session: Pick<tabContainerData, 'windows'>
): number {
  const isFirst = firstCopyFilter();
  return session.windows.reduce(
    (n, w) => n + w.tabs.filter((t) => !isFirst(t)).length,
    0
  );
}
