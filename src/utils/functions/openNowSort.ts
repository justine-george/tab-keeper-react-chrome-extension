// KAN-694. Sort tabs by site in a live window: the order, and the Chrome calls that put a window in it.
import type { OpenTab, OpenWindow } from './openNow';
import type { TabPlace } from './openNowMoves';
import { isSortedBySite, sortBySite, type SortableTab } from './sortBySite';

// chrome.tabGroups.TAB_GROUP_ID_NONE, spelled out: chrome.tabGroups is absent without the grant.
const NO_GROUP = -1;

// One step of a live order below the pinned run: a loose tab, or a whole group.
export type LiveUnit =
  { kind: 'tab'; id: number } | { kind: 'group'; id: number };

// A window's order as Chrome calls can set it: the pinned tabs, then the rest as units.
export interface LiveOrder {
  pinned: number[];
  rest: LiveUnit[];
}

// What the order reads of a live tab. Chrome gives every tab in a strip an id; a tab without one is skipped.
export type LiveTab = Pick<
  chrome.tabs.Tab,
  'id' | 'index' | 'groupId' | 'pinned'
>;

interface PlacedTab {
  id: number;
  groupId: number;
  pinned: boolean;
}

function inStripOrder<T extends LiveTab>(
  tabs: readonly T[]
): (T & { id: number })[] {
  return tabs
    .filter((tab): tab is T & { id: number } => typeof tab.id === 'number')
    .sort((a, b) => a.index - b.index);
}

// Tabs in order as a LiveOrder: a grouped tab is its group's unit, at the group's first tab, as sortBySite counts it.
function orderOf(tabs: readonly PlacedTab[]): LiveOrder {
  const pinned: number[] = [];
  const rest: LiveUnit[] = [];
  const seenGroups = new Set<number>();
  for (const tab of tabs) {
    if (tab.groupId !== NO_GROUP) {
      if (!seenGroups.has(tab.groupId)) {
        seenGroups.add(tab.groupId);
        rest.push({ kind: 'group', id: tab.groupId });
      }
    } else if (tab.pinned) {
      pinned.push(tab.id);
    } else {
      rest.push({ kind: 'tab', id: tab.id });
    }
  }
  return { pinned, rest };
}

// Every tab given, as it stands now.
export function liveOrderOf(tabs: readonly LiveTab[]): LiveOrder {
  return orderOf(inStripOrder(tabs));
}

// The sorted order of a window's tabs, the Tab Keeper page left out (spec: it is never passed to a move).
export function liveSortOrder(
  tabs: readonly chrome.tabs.Tab[],
  isTabKeeperPage: (tab: chrome.tabs.Tab) => boolean
): LiveOrder {
  const sortable = inStripOrder(tabs)
    .filter((tab) => !isTabKeeperPage(tab))
    .map((tab) => ({
      key: String(tab.id),
      url: tab.url || tab.pendingUrl || '',
      pinned: tab.pinned,
      groupKey: tab.groupId !== NO_GROUP ? String(tab.groupId) : null,
      // A window with a split is not sorted live (holdsSplitView), so no pair is kept.
      splitKey: null,
      id: tab.id,
      groupId: tab.groupId,
    }));
  return orderOf(sortBySite(sortable));
}

export function sameLiveOrder(a: LiveOrder, b: LiveOrder): boolean {
  return (
    a.pinned.length === b.pinned.length &&
    a.pinned.every((id, i) => id === b.pinned[i]) &&
    a.rest.length === b.rest.length &&
    a.rest.every(
      (unit, i) => unit.kind === b.rest[i]?.kind && unit.id === b.rest[i]?.id
    )
  );
}

// The order a sort's record says the window had: each tab at its `before` index and group, pinned as it is now (a sort never pins or unpins).
export function orderBeforeSort(
  records: readonly { tabId: number; before: TabPlace; pinned: boolean }[]
): LiveOrder {
  return orderOf(
    [...records]
      .sort((a, b) => a.before.index - b.before.index)
      .map(({ tabId, before, pinned }) => ({
        id: tabId,
        groupId: before.groupId,
        pinned,
      }))
  );
}

async function succeeds(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return true;
  } catch {
    return false;
  }
}

// KAN-743. The units that stay still: one longest run already in the target's order. `ranks` gives each unit's place in the target, in the order the units sit now.
export function keptInPlace(ranks: readonly number[]): Set<number> {
  // tails[k]: the smallest rank ending a run of length k + 1; tailAt[k]: where it sits.
  const tails: number[] = [];
  const tailAt: number[] = [];
  const previous: number[] = [];
  ranks.forEach((rank, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < rank) low = mid + 1;
      else high = mid;
    }
    tails[low] = rank;
    tailAt[low] = i;
    previous[i] = low > 0 ? tailAt[low - 1] : -1;
  });
  const kept = new Set<number>();
  for (let i = tailAt[tails.length - 1] ?? -1; i !== -1; i = previous[i]) {
    kept.add(ranks[i]);
  }
  return kept;
}

function holds(unit: LiveUnit, tab: LiveTab): boolean {
  return unit.kind === 'group' ? tab.groupId === unit.id : tab.id === unit.id;
}

// KAN-743. Where unit `i` of `units` goes: right after the last tab of the unit before it, or the region's start. `to` is the index Chrome's move takes, its first tab's index once moved. Null when the unit or the one before it has no tab in `strip`.
export function spotFor(
  strip: readonly LiveTab[],
  units: readonly LiveUnit[],
  i: number,
  regionStart: number
): { from: number; to: number } | null {
  const unit = units[i];
  const span = unit ? strip.filter((tab) => holds(unit, tab)) : [];
  if (span.length === 0) return null;
  const from = span[0].index;
  if (i === 0) return { from, to: regionStart };
  const before = units[i - 1];
  const beforeSpan = strip.filter((tab) => holds(before, tab));
  const last = beforeSpan[beforeSpan.length - 1];
  if (last === undefined) return null;
  // From the left, the unit's own tabs leave the strip ahead of the spot.
  const to = from > last.index ? last.index + 1 : last.index + 1 - span.length;
  return { from, to };
}

// The window's tabs in strip order, or null when Chrome refuses the read.
async function readStrip(windowId: number): Promise<LiveTab[] | null> {
  try {
    return inStripOrder(await chrome.tabs.query({ windowId }));
  } catch {
    return null;
  }
}

// Puts a window's tabs in `order` (KAN-743): per region, pinned then the rest, the units already in order stay still and each other moves once, right after the unit before it.
// Tabs left out of the order stay, and are pushed along. False at the first call Chrome refuses or a unit gone from the strip, with the tabs where Chrome left them; false before any call when a group is to move and chrome.tabGroups is absent.
export async function applyLiveOrder(
  windowId: number,
  order: LiveOrder
): Promise<boolean> {
  const movesGroups = order.rest.some((unit) => unit.kind === 'group');
  if (movesGroups && !chrome.tabGroups) return false;
  const regions: [LiveUnit[], boolean][] = [
    [order.pinned.map((id) => ({ kind: 'tab', id })), true],
    [order.rest, false],
  ];
  for (const [units, pinned] of regions) {
    const strip = await readStrip(windowId);
    if (strip === null) return false;
    const ranks: number[] = [];
    for (const tab of strip) {
      const rank = units.findIndex((unit) => holds(unit, tab));
      if (rank !== -1 && !ranks.includes(rank)) ranks.push(rank);
    }
    const kept = keptInPlace(ranks);
    for (const [i, unit] of units.entries()) {
      if (kept.has(i)) continue;
      const now = await readStrip(windowId);
      if (now === null) return false;
      const regionStart = pinned ? 0 : now.filter((tab) => tab.pinned).length;
      const spot = spotFor(now, units, i, regionStart);
      if (spot === null) return false;
      if (spot.from === spot.to) continue;
      const index = spot.to;
      const moved = await succeeds(() =>
        unit.kind === 'tab'
          ? chrome.tabs.move(unit.id, { index })
          : chrome.tabGroups.move(unit.id, { index })
      );
      if (!moved) return false;
    }
  }
  return true;
}

// Whether any tab is in a split view: tabs.move ends a split, and only a group move keeps one (KAN-694 Task 1, Q4).
export function holdsSplitView(
  tabs: readonly { splitViewId?: number }[]
): boolean {
  return tabs.some(
    (tab) => tab.splitViewId !== undefined && tab.splitViewId >= 0
  );
}

// Whether Open now may sort this window live: with the tab group grant (without it Chrome hides the groups a sort would break), and with no split view.
export function canSortOpenWindowLive(
  window: OpenWindow,
  hasTabGroups: boolean
): boolean {
  return hasTabGroups && !holdsSplitView(window.tabs);
}

function openSortable(tab: OpenTab): SortableTab {
  return {
    key: String(tab.id),
    url: tab.url,
    pinned: tab.pinned,
    groupKey: tab.groupId === null ? null : String(tab.groupId),
    splitKey: null,
  };
}

// Whether the listed tabs (Tab Keeper pages are not listed) are already in the sorted order.
export function isOpenWindowSortedBySite(window: OpenWindow): boolean {
  return isSortedBySite(window.tabs.map(openSortable));
}
