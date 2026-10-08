import type {
  CarriedRef,
  tabContainerData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

// This module is imported by the service worker (via windows.ts) AND by the
// right pane, so it must stay DOM-free -- no `window`, no `document`. Same
// constraint, and the same reason, as mergeTabData.ts.

// Chrome's nine group colours, as of Chrome 137.
export const TAB_GROUP_COLORS = [
  'blue',
  'cyan',
  'green',
  'grey',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
] as const;

export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

// Deliberately NOT theme-varying. There are five themes, so a per-theme map
// would be 45 entries -- and the colour is not app chrome, it is the identity
// the user picked in Chrome. It should read the same here as in the browser.
export const TAB_GROUP_COLOR_HEX: Record<TabGroupColor, string> = {
  blue: '#8ab4f8',
  cyan: '#78d9ec',
  green: '#81c995',
  grey: '#dadce0',
  orange: '#fcad70',
  pink: '#ff8bcb',
  purple: '#c58af9',
  red: '#f28b82',
  yellow: '#fdd663',
};

// What a saved group looks like on disk.
//
// `groupId` is a uuid minted at capture, NOT Chrome's numeric group id.
// Chrome's ids are unique only within a browser session and are reused after a
// restart, so persisting one as identity in data that is synced and merged
// across devices lets two devices collide on unrelated groups. Nothing ever
// hands this value back to Chrome as an id; it is only the join key to
// tabData.chromeGroupId.
//
// `color` is `string`, not TabGroupColor, because `string` is all that has
// been proven about a value that arrived from a cloud document or an imported
// file. It is narrowed at the Chrome boundary by sanitizeTabGroupColor.
export interface chromeTabGroupData {
  groupId: string;
  title: string;
  color: string;
  // KAN-460. Present only when the group was collapsed; restore collapses it again. Never false: absent is open.
  collapsed?: true;
}

const KNOWN_COLORS: readonly string[] = TAB_GROUP_COLORS;

// Narrowing happens HERE rather than in isValidTabMasterContainer on purpose.
// That validator gates the whole container on both the import path and the
// cloud read, so rejecting an unrecognised colour there would fail every
// session for that user on every sync, forever, the first time Chrome adds a
// tenth colour. Degrading one group to grey is the containable failure.
export function sanitizeTabGroupColor(value: string): TabGroupColor {
  return KNOWN_COLORS.includes(value) ? (value as TabGroupColor) : 'grey';
}

// The two fields of a tab that a partition reads: its id, and the group it
// claims. A saved tabData has both; so does a live tab mapped to string ids
// (KAN-280), which is what lets both panes draw with the same partition.
export type GroupableTab = Pick<tabData, 'tabId' | 'chromeGroupId'>;

export type TabRun<T extends GroupableTab = tabData> =
  | { kind: 'ungrouped'; tabs: T[] }
  | { kind: 'group'; group: chromeTabGroupData; tabs: T[] };

// Split a window's flat tab list into the runs the right pane renders.
//
// Chrome groups are contiguous runs of tabs, so grouping is a partition of the
// stored array rather than a nested shape -- which is what keeps deleteTab,
// the search filter, the validators and the merge walking a flat list.
//
// A group is emitted at the position of its FIRST member, and every tab
// claiming that group joins it wherever it sits. Non-contiguous membership is
// unreachable through Chrome but reachable through an import or a merge;
// coalescing keeps this pane agreeing with the restore, which calls
// tabs.group and makes those tabs contiguous.
export function partitionTabsIntoRuns<T extends GroupableTab>(
  tabs: readonly T[],
  groups: readonly chromeTabGroupData[] | undefined
): TabRun<T>[] {
  const byId = new Map<string, chromeTabGroupData>();
  for (const group of groups ?? []) {
    byId.set(group.groupId, group);
  }

  const runs: TabRun<T>[] = [];
  // Where a group's run already sits, so a later member joins it rather than
  // opening a second identically-named band.
  const groupRuns = new Map<
    string,
    { kind: 'group'; group: chromeTabGroupData; tabs: T[] }
  >();

  for (const tab of tabs) {
    // An id with no matching group is treated as ungrouped rather than
    // dropped: the tab is the user's data, the group reference is not.
    const group =
      tab.chromeGroupId === undefined ? undefined : byId.get(tab.chromeGroupId);

    if (!group) {
      const last = runs[runs.length - 1];
      if (last && last.kind === 'ungrouped') {
        last.tabs.push(tab);
      } else {
        runs.push({ kind: 'ungrouped', tabs: [tab] });
      }
      continue;
    }

    const existing = groupRuns.get(group.groupId);
    if (existing) {
      existing.tabs.push(tab);
      continue;
    }

    const run = { kind: 'group' as const, group, tabs: [tab] };
    groupRuns.set(group.groupId, run);
    runs.push(run);
  }

  return runs;
}

// One group's run, as partitionTabsIntoRuns produces it.
export type GroupRun<T extends GroupableTab = tabData> = Extract<
  TabRun<T>,
  { kind: 'group' }
>;

// A top-level row of a window: a loose tab, or a whole group.
export type TabItem<T extends GroupableTab = tabData> =
  | { kind: 'tab'; tab: T }
  | GroupRun<T>;

// The rows a window draws at the top level, in order (KAN-160): each loose tab
// on its own, each group as one item holding its tabs.
//
// Built FROM partitionTabsIntoRuns rather than beside it, so the screen and
// moveChromeGroupInternal cannot disagree about what index n means -- which is
// the whole of KAN-131.
export function partitionTabsIntoItems<T extends GroupableTab>(
  tabs: readonly T[],
  groups: readonly chromeTabGroupData[] | undefined
): TabItem<T>[] {
  return partitionTabsIntoRuns(tabs, groups).flatMap((run): TabItem<T>[] =>
    run.kind === 'ungrouped'
      ? run.tabs.map((tab) => ({ kind: 'tab', tab }))
      : [run]
  );
}

const TAB_ITEM = 'tab:';
const GROUP_ITEM = 'group:';

// Prefixed, so a tab id and a group id can share one drag list without ever
// colliding.
export const itemIdOf = (item: TabItem<GroupableTab>): string =>
  item.kind === 'tab'
    ? `${TAB_ITEM}${item.tab.tabId}`
    : groupItemIdOf(item.group.groupId);

// A group's item id from the group id alone, for a caller that names the group
// before it has its item in hand. The inverse of groupIdOfItemId.
export function groupItemIdOf(groupId: string): string {
  return `${GROUP_ITEM}${groupId}`;
}

export function groupIdOfItemId(itemId: string): string | undefined {
  return itemId.startsWith(GROUP_ITEM)
    ? itemId.slice(GROUP_ITEM.length)
    : undefined;
}

/**
 * Whether the store still holds the carried item where the carry found it:
 * its session, its window, and the tab, the group (with a tab in it, as the
 * move reducer's partition sees it) or the window. False means the move would
 * find nothing to lift, so the carry has nothing left to carry.
 */
export function isCarriedStillThere(
  tabGroups: readonly tabContainerData[],
  carried: CarriedRef
): boolean {
  const w = tabGroups
    .find((g) => g.tabGroupId === carried.tabGroupId)
    ?.windows.find((x) => x.windowId === carried.windowId);
  if (w === undefined) return false;
  switch (carried.kind) {
    case 'window':
      return true;
    case 'tab':
      return w.tabs.some((t) => t.tabId === carried.tabId);
    case 'group':
      return partitionTabsIntoRuns(w.tabs, w.chromeTabGroups).some(
        (run) => run.kind === 'group' && run.group.groupId === carried.groupId
      );
  }
}
