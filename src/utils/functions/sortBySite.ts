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

// Pinned, then group blocks in first-seen order, then loose tabs, each section grouped by site (KAN-694).
export function sortBySite<T extends SortableTab>(tabs: readonly T[]): T[] {
  const blocks = new Map<string, T[]>();
  const pinned: Unit<T>[] = [];
  const loose: Unit<T>[] = [];

  // A split pair only counts while exactly two tabs share the key and sit side by side, as restore's splitPairs does.
  const splitCount = new Map<string, number>();
  for (const tab of tabs) {
    if (tab.splitKey !== null) {
      splitCount.set(tab.splitKey, (splitCount.get(tab.splitKey) ?? 0) + 1);
    }
  }

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    // A pinned tab in a group is a group member.
    if (tab.groupKey !== null) {
      const block = blocks.get(tab.groupKey);
      if (block) block.push(tab);
      else blocks.set(tab.groupKey, [tab]);
      continue;
    }

    const next = tabs[i + 1];
    const pairs =
      tab.splitKey !== null &&
      splitCount.get(tab.splitKey) === 2 &&
      next !== undefined &&
      next.splitKey === tab.splitKey &&
      next.groupKey === null &&
      next.pinned === tab.pinned;
    const unit: Unit<T> = {
      tabs: pairs ? [tab, next] : [tab],
      site: siteOf(tab.url),
    };
    (tab.pinned ? pinned : loose).push(unit);
    if (pairs) i++;
  }

  return [
    ...groupUnitsBySite(pinned),
    ...[...blocks.values()].flat(),
    ...groupUnitsBySite(loose),
  ];
}

export function isSortedBySite(tabs: readonly SortableTab[]): boolean {
  const sorted = sortBySite(tabs);
  return sorted.every((tab, i) => tab.key === tabs[i].key);
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
