// KAN-280 Part F (spec O12c). What a copy of a live item lands: D6 A's skips, against every tab of the target session.
import type { CarriedPick } from '../../redux/carriedItem';
import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { forgetMissingActiveTab } from './pinnedRun';
import { partitionTabsIntoRuns, type chromeTabGroupData } from './tabGroups';

// What lands, or null when every tab was already there; and how many were.
export interface Planned<T> {
  content: T | null;
  skipped: number;
}

// The saved addresses a session holds. An empty address names no page, so it matches nothing (P7).
export function addressesIn(session: tabContainerData): Set<string> {
  return new Set(
    session.windows
      .flatMap((w) => w.tabs.map((t) => t.url))
      .filter((url) => url !== '')
  );
}

// Fresh objects, never the snapshot's: the store freezes what it is given, and the reducer re-mints in place.
const fresh = (t: tabData): tabData => ({ ...t });

export function tabsToCopy(
  snapshot: windowGroupData,
  pick: Exclude<CarriedPick, { kind: 'window' }>,
  taken: ReadonlySet<string>
): Planned<{ tabs: tabData[]; group: chromeTabGroupData | undefined }> {
  const isNew = (t: tabData) => !taken.has(t.url);
  if (pick.kind === 'tab') {
    const tab = snapshot.tabs.find((t) => t.tabId === pick.tabId);
    if (tab === undefined) return { content: null, skipped: 0 };
    if (!isNew(tab)) return { content: null, skipped: 1 };
    // O13: a tab copied on its own leaves its group and its split.
    const loose = fresh(tab);
    delete loose.chromeGroupId;
    delete loose.splitId;
    return { content: { tabs: [loose], group: undefined }, skipped: 0 };
  }
  // The SAME partition the screen draws (KAN-131).
  const run = partitionTabsIntoRuns(
    snapshot.tabs,
    snapshot.chromeTabGroups
  ).find((r) => r.kind === 'group' && r.group.groupId === pick.groupId);
  if (run === undefined || run.kind !== 'group') {
    return { content: null, skipped: 0 };
  }
  const tabs = run.tabs.filter(isNew).map(fresh);
  const skipped = run.tabs.length - tabs.length;
  return tabs.length === 0
    ? { content: null, skipped }
    : { content: { tabs, group: { ...run.group } }, skipped };
}

export function windowToCopy(
  snapshot: windowGroupData,
  taken: ReadonlySet<string>
): Planned<windowGroupData> {
  const tabs = snapshot.tabs.filter((t) => !taken.has(t.url)).map(fresh);
  const skipped = snapshot.tabs.length - tabs.length;
  if (tabs.length === 0) return { content: null, skipped };
  const { chromeTabGroups, ...rest } = snapshot;
  // A group left with no tabs adds no group.
  const groups = (chromeTabGroups ?? [])
    .filter((g) => tabs.some((t) => t.chromeGroupId === g.groupId))
    .map((g) => ({ ...g }));
  const window: windowGroupData = {
    ...rest,
    tabCount: tabs.length,
    tabs,
    ...(groups.length > 0 ? { chromeTabGroups: groups } : {}),
  };
  forgetMissingActiveTab(window);
  return { content: window, skipped };
}

// What the toast reports for a copy of `pick` into a session holding `taken`.
export function copyOutcome(
  snapshot: windowGroupData,
  pick: CarriedPick,
  taken: ReadonlySet<string>
): { skipped: number; copiesAny: boolean } {
  const planned =
    pick.kind === 'window'
      ? windowToCopy(snapshot, taken)
      : tabsToCopy(snapshot, pick, taken);
  return { skipped: planned.skipped, copiesAny: planned.content !== null };
}
