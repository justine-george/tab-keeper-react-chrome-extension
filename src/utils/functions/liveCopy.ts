// KAN-280 Part F (spec O12c), KAN-608. What a copy of a live item lands: everything picked, duplicates included.
import type { CarriedPick } from '../../redux/carriedItem';
import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { partitionTabsIntoRuns, type chromeTabGroupData } from './tabGroups';

// Fresh objects, never the snapshot's: the store freezes what it is given, and the reducer re-mints in place.
const fresh = (t: tabData): tabData => ({ ...t });

// A tab, loose; or a group's run with its entry. Null when the snapshot holds no such pick.
export function tabsToCopy(
  snapshot: windowGroupData,
  pick: Exclude<CarriedPick, { kind: 'window' }>
): { tabs: tabData[]; group: chromeTabGroupData | undefined } | null {
  if (pick.kind === 'tab') {
    const tab = snapshot.tabs.find((t) => t.tabId === pick.tabId);
    if (tab === undefined) return null;
    // O13: a tab copied on its own leaves its group and its split.
    const loose = fresh(tab);
    delete loose.chromeGroupId;
    delete loose.splitId;
    return { tabs: [loose], group: undefined };
  }
  // The SAME partition the screen draws (KAN-131).
  const run = partitionTabsIntoRuns(
    snapshot.tabs,
    snapshot.chromeTabGroups
  ).find((r) => r.kind === 'group' && r.group.groupId === pick.groupId);
  if (run === undefined || run.kind !== 'group') return null;
  return { tabs: run.tabs.map(fresh), group: { ...run.group } };
}

// The whole window. Null for a window with no tabs, which nothing lists.
export function windowToCopy(
  snapshot: windowGroupData
): windowGroupData | null {
  if (snapshot.tabs.length === 0) return null;
  const { chromeTabGroups, ...rest } = snapshot;
  return {
    ...rest,
    tabs: snapshot.tabs.map(fresh),
    ...(chromeTabGroups === undefined
      ? {}
      : { chromeTabGroups: chromeTabGroups.map((g) => ({ ...g })) }),
  };
}

// Whether a copy of `pick` lands anything at all.
export const copiesAnything = (
  snapshot: windowGroupData,
  pick: CarriedPick
): boolean =>
  pick.kind === 'window'
    ? windowToCopy(snapshot) !== null
    : tabsToCopy(snapshot, pick) !== null;
