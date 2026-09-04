import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

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

export type TabRun =
  | { kind: 'ungrouped'; tabs: tabData[] }
  | { kind: 'group'; group: chromeTabGroupData; tabs: tabData[] };

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
export function partitionTabsIntoRuns(
  tabs: tabData[],
  groups: chromeTabGroupData[] | undefined
): TabRun[] {
  const byId = new Map<string, chromeTabGroupData>();
  for (const group of groups ?? []) {
    byId.set(group.groupId, group);
  }

  const runs: TabRun[] = [];
  // Where a group's run already sits, so a later member joins it rather than
  // opening a second identically-named band.
  const groupRuns = new Map<
    string,
    { kind: 'group'; group: chromeTabGroupData; tabs: tabData[] }
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
