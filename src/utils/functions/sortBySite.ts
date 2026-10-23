import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { resolveTabUrl } from './local';

// What the order needs to know about a tab; saved and live tabs both map onto it.
export interface SortableTab {
  key: string;
  url: string;
  pinned: boolean;
  groupKey: string | null;
  splitKey: string | null;
}

// The hostname of the page a tab stands for, lowercased, one leading www. removed; null for anything but http(s).
export function siteOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(resolveTabUrl(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname.toLowerCase().replace(/^www\./, '');
}

// A single tab, or two adjacent tabs of one split view that travel together.
type Unit<T> = { tabs: T[]; site: string | null };

// Sites in the order their first unit appears, each site's units in order, no-site units last in order.
function groupUnitsBySite<T>(units: Unit<T>[]): T[] {
  const bySite = new Map<string, Unit<T>[]>();
  const noSite: Unit<T>[] = [];
  for (const unit of units) {
    if (unit.site === null) {
      noSite.push(unit);
      continue;
    }
    const same = bySite.get(unit.site);
    if (same) same.push(unit);
    else bySite.set(unit.site, [unit]);
  }
  return [...bySite.values(), noSite].flat().flatMap((unit) => unit.tabs);
}

// How many tabs share each split key.
function splitCounts(tabs: readonly SortableTab[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    if (tab.splitKey !== null) {
      counts.set(tab.splitKey, (counts.get(tab.splitKey) ?? 0) + 1);
    }
  }
  return counts;
}

// The unit starting at tabs[i]: a split pair only while exactly two tabs share the key and sit side by side, in one group and pin state, as restore's splitPairs does.
function unitAt<T extends SortableTab>(
  tabs: readonly T[],
  i: number,
  splits: Map<string, number>
): Unit<T> {
  const tab = tabs[i];
  const next = tabs[i + 1];
  const pairs =
    tab.splitKey !== null &&
    splits.get(tab.splitKey) === 2 &&
    next !== undefined &&
    next.splitKey === tab.splitKey &&
    next.groupKey === tab.groupKey &&
    next.pinned === tab.pinned;
  return { tabs: pairs ? [tab, next] : [tab], site: siteOf(tab.url) };
}

// Pinned, then group blocks in first-seen order, then loose tabs, each section grouped by site (KAN-694).
export function sortBySite<T extends SortableTab>(tabs: readonly T[]): T[] {
  const blocks = new Map<string, T[]>();
  const pinned: Unit<T>[] = [];
  const loose: Unit<T>[] = [];
  const splits = splitCounts(tabs);

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    // A pinned tab in a group is a group member.
    if (tab.groupKey !== null) {
      const block = blocks.get(tab.groupKey);
      if (block) block.push(tab);
      else blocks.set(tab.groupKey, [tab]);
      continue;
    }
    const unit = unitAt(tabs, i, splits);
    (tab.pinned ? pinned : loose).push(unit);
    i += unit.tabs.length - 1;
  }

  return [
    ...groupUnitsBySite(pinned),
    ...[...blocks.values()].flat(),
    ...groupUnitsBySite(loose),
  ];
}

// KAN-746. One group's tabs grouped by site among themselves, in the slots the group's tabs held; every other tab stays.
export function sortWithinGroup<T extends SortableTab>(
  tabs: readonly T[],
  groupKey: string
): T[] {
  const splits = splitCounts(tabs);
  const units: Unit<T>[] = [];
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].groupKey !== groupKey) continue;
    const unit = unitAt(tabs, i, splits);
    units.push(unit);
    i += unit.tabs.length - 1;
  }
  const sorted = groupUnitsBySite(units);
  let next = 0;
  return tabs.map((tab) => (tab.groupKey === groupKey ? sorted[next++] : tab));
}

function sameOrder(
  a: readonly SortableTab[],
  b: readonly SortableTab[]
): boolean {
  return a.every((tab, i) => tab.key === b[i].key);
}

export function isSortedBySite(tabs: readonly SortableTab[]): boolean {
  return sameOrder(sortBySite(tabs), tabs);
}

export function isGroupSortedBySite(
  tabs: readonly SortableTab[],
  groupKey: string
): boolean {
  return sameOrder(sortWithinGroup(tabs, groupKey), tabs);
}

// A saved tab with the order's fields added; pinned is a plain boolean here, so map back by key to keep the saved tab's own shape.
export function savedSortable(
  tab: tabData
): Omit<tabData, 'pinned'> & SortableTab {
  return {
    ...tab,
    key: tab.tabId,
    pinned: tab.pinned === true,
    groupKey: tab.chromeGroupId ?? null,
    splitKey: tab.splitId ?? null,
  };
}

export function isSavedWindowSortedBySite(
  window: Pick<windowGroupData, 'tabs'>
): boolean {
  return isSortedBySite(window.tabs.map(savedSortable));
}

// KAN-746. `groupId` is the saved group's uuid (chromeTabGroupData.groupId).
export function isSavedGroupSortedBySite(
  window: Pick<windowGroupData, 'tabs'>,
  groupId: string
): boolean {
  return isGroupSortedBySite(window.tabs.map(savedSortable), groupId);
}
