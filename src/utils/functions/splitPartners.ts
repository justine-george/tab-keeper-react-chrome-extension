import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import type { OpenTab } from './openNow';
import { splitPairs } from './savedPairs';

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

// KAN-486. Both tab ids of every whole pair, each mapped to the half with the
// lower index: the head, which names the pair's one row.
export function splitHeadOf(tabs: readonly OpenTab[]): Map<number, number> {
  const partners = openSplitPartners(tabs);
  const heads = new Map<number, number>();
  for (const tab of tabs) {
    const partner = partners.get(tab.id);
    if (partner === undefined) continue;
    heads.set(tab.id, tab.index < partner.index ? tab.id : partner.id);
  }
  return heads;
}

// KAN-486. The tabs with each pair's second half left out.
export function withoutSplitFollowers<T extends OpenTab>(
  tabs: readonly T[]
): T[] {
  const heads = splitHeadOf(tabs);
  return tabs.filter((tab) => (heads.get(tab.id) ?? tab.id) === tab.id);
}

// KAN-486. One span of real tab indices per row, in order. A pair spans both.
export function rowSpansOf(
  tabs: readonly OpenTab[]
): { first: number; last: number }[] {
  const partners = openSplitPartners(tabs);
  return withoutSplitFollowers(tabs).map((tab) => ({
    first: tab.index,
    last: partners.get(tab.id)?.index ?? tab.index,
  }));
}
