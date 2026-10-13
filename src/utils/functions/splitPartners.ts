import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import type { OpenTab } from './openNow';
import { splitPairs } from './windows';

// KAN-564. Each saved tab's other half, for exactly the pairs a restore
// splits (splitPairs): a pair Chrome would refuse comes back as two ordinary
// tabs, so it is not marked.
export function savedSplitPartners(
  tabs: readonly tabData[]
): Map<string, tabData> {
  const partners = new Map<string, tabData>();
  for (const [i, j] of splitPairs(tabs)) {
    partners.set(tabs[i].tabId, tabs[j]);
    partners.set(tabs[j].tabId, tabs[i]);
  }
  return partners;
}

// KAN-564. Each drawn tab's other half in a live Chrome split. A half this
// pane leaves out (a Tab Keeper page) leaves the other unmarked: a mark must
// name a row the user can see.
export function openSplitPartners(
  tabs: readonly OpenTab[]
): Map<number, OpenTab> {
  const bySplit = new Map<number, OpenTab[]>();
  for (const tab of tabs) {
    if (tab.splitViewId === undefined) continue;
    bySplit.set(tab.splitViewId, [
      ...(bySplit.get(tab.splitViewId) ?? []),
      tab,
    ]);
  }
  const partners = new Map<number, OpenTab>();
  for (const halves of bySplit.values()) {
    if (halves.length !== 2) continue;
    const [a, b] = halves;
    partners.set(a.id, b);
    partners.set(b.id, a);
  }
  return partners;
}
