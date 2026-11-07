// KAN-942. A saved window as rows: a pair a restore would split is one row, named by its first half. Types only, so tabGroups.ts can read it.
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import type { TabItem } from './tabGroups';

// KAN-460 Part 4. The saved pairs a restore splits: exactly two tabs share a
// splitId, side by side, both pinned or neither, in the same group. Chrome
// refuses any other pair (measured), so it opens as ordinary tabs (pick a).
export function splitPairs(tabs: readonly tabData[]): [number, number][] {
  const at = new Map<string, number[]>();
  tabs.forEach((tab, i) => {
    if (tab.splitId === undefined) return;
    at.set(tab.splitId, [...(at.get(tab.splitId) ?? []), i]);
  });
  return [...at.values()].flatMap((indexes): [number, number][] => {
    if (indexes.length !== 2) return [];
    const [i, j] = indexes;
    const [a, b] = [tabs[i], tabs[j]];
    return j === i + 1 &&
      a.pinned === b.pinned &&
      a.chromeGroupId === b.chromeGroupId
      ? [[i, j]]
      : [];
  });
}

// Each pair's second half: the tabs that draw inside another's row.
export function savedFollowerIds(tabs: readonly tabData[]): Set<string> {
  return new Set(splitPairs(tabs).map(([, j]) => tabs[j].tabId));
}

export function withoutSavedFollowers<T extends tabData>(
  tabs: readonly T[]
): T[] {
  const followers = savedFollowerIds(tabs);
  return tabs.filter((tab) => !followers.has(tab.tabId));
}

// The windows as rows. The same window object when it holds no pair, and the same array when none does.
export function savedRowWindows<W extends { tabs: readonly tabData[] }>(
  windows: readonly W[]
): readonly W[] {
  const rows = windows.map((w) => {
    const tabs = withoutSavedFollowers(w.tabs);
    return tabs.length === w.tabs.length ? w : { ...w, tabs };
  });
  return rows.every((w, i) => w === windows[i]) ? windows : rows;
}

// True when a restore would split exactly these two, in this order.
export function isSavedPair(
  tabs: readonly tabData[],
  tabId: string,
  partnerTabId: string
): boolean {
  return splitPairs(tabs).some(
    ([i, j]) => tabs[i].tabId === tabId && tabs[j].tabId === partnerTabId
  );
}

// Where row `rowIndex` starts in a list whose followers draw no row of their own.
function indexOfRow(isFollower: readonly boolean[], rowIndex: number): number {
  let row = 0;
  for (const [i, follows] of isFollower.entries()) {
    if (follows) continue;
    if (row === rowIndex) return i;
    row += 1;
  }
  return isFollower.length;
}

const isFollowerItem = (item: TabItem, followers: ReadonlySet<string>) =>
  item.kind === 'tab' && followers.has(item.tab.tabId);

// `tabs` as drawn, the held row still in them: pairs are read BEFORE the held ids come out, as a tab lifted from between two halves makes no pair.
export function tabIndexOfRow(
  tabs: readonly tabData[],
  heldIds: ReadonlySet<string>,
  rowIndex: number
): number {
  const followers = savedFollowerIds(tabs);
  return indexOfRow(
    tabs
      .filter((tab) => !heldIds.has(tab.tabId))
      .map((tab) => followers.has(tab.tabId)),
    rowIndex
  );
}

// `items` with the held group already out; `followers` from the whole window.
export function itemIndexOfRow(
  items: readonly TabItem[],
  followers: ReadonlySet<string>,
  rowIndex: number
): number {
  return indexOfRow(
    items.map((item) => isFollowerItem(item, followers)),
    rowIndex
  );
}

// A slot whose next row is a follower sits inside a pair: one step past it. `slot` counts `tabs` with the held ids out.
export function slotOutsidePairs(
  tabs: readonly tabData[],
  heldIds: ReadonlySet<string>,
  slot: number
): number {
  const followers = savedFollowerIds(tabs);
  const next = tabs.filter((tab) => !heldIds.has(tab.tabId))[slot];
  return next !== undefined && followers.has(next.tabId) ? slot + 1 : slot;
}

// As slotOutsidePairs, for a slot among `items`.
export function itemSlotOutsidePairs(
  items: readonly TabItem[],
  followers: ReadonlySet<string>,
  slot: number
): number {
  const next = items[slot];
  return next !== undefined && isFollowerItem(next, followers)
    ? slot + 1
    : slot;
}
