import type { CarriedPick } from '../../redux/carriedItem';
import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { tabsToCopy } from './liveCopy';

// KAN-906. Every address the session has; a tab with none is never an address.
export function urlsIn(
  session: Pick<tabContainerData, 'windows'>
): Set<string> {
  const urls = new Set<string>();
  for (const w of session.windows)
    for (const t of w.tabs) if (t.url !== '') urls.add(t.url);
  return urls;
}

// Same rule as firstCopyFilter (KAN-609), but it must look without remembering, for a split pair.
const isNew = (seen: ReadonlySet<string>, tab: tabData) =>
  tab.url === '' || !seen.has(tab.url);

// KAN-906. The windows as they would be with every tab whose address is in `already`, or earlier in them, left out. A split pair is kept whole unless both halves repeat.
export function leaveOutDuplicates(
  windows: readonly windowGroupData[],
  already: ReadonlySet<string>
): { windows: windowGroupData[]; leftOut: number } {
  const seen = new Set(already);
  const kept: windowGroupData[] = [];
  let leftOut = 0;
  for (const w of windows) {
    const pairKept = new Map<string, boolean>();
    const tabs: tabData[] = [];
    for (const t of w.tabs) {
      const unit =
        t.splitId === undefined
          ? [t]
          : w.tabs.filter((o) => o.splitId === t.splitId);
      let keep = t.splitId === undefined ? undefined : pairKept.get(t.splitId);
      if (keep === undefined) {
        keep = unit.some((u) => isNew(seen, u));
        if (t.splitId !== undefined) pairKept.set(t.splitId, keep);
        if (keep) for (const u of unit) seen.add(u.url);
      }
      if (keep) tabs.push(t);
      else leftOut += 1;
    }
    if (tabs.length === 0) continue;
    const { chromeTabGroups, ...rest } = w;
    const groups = chromeTabGroups?.filter((g) =>
      tabs.some((t) => t.chromeGroupId === g.groupId)
    );
    kept.push({
      ...rest,
      tabs,
      tabCount: tabs.length,
      ...(groups && groups.length > 0 ? { chromeTabGroups: groups } : {}),
    });
  }
  return { windows: kept, leftOut };
}

// KAN-906. A new session keeps one copy of each address.
export function withoutRepeats(container: tabContainerData): {
  container: tabContainerData;
  leftOut: number;
} {
  const { windows, leftOut } = leaveOutDuplicates(container.windows, new Set());
  return {
    container: {
      ...container,
      windows,
      windowCount: windows.length,
      tabCount: windows.reduce((n, w) => n + w.tabCount, 0),
    },
    leftOut,
  };
}

// KAN-906. The live window with each tab `pick` takes left out when its address is in `already` or earlier in the pick; untaken tabs stay so the pick still resolves. A lone tab is judged as copied: without its split twin.
export function withoutPickedRepeats(
  snapshot: windowGroupData,
  pick: CarriedPick,
  already: ReadonlySet<string>
): { window: windowGroupData; leftOut: number } {
  const picked =
    pick.kind === 'window' ? snapshot.tabs : tabsToCopy(snapshot, pick)?.tabs;
  if (picked === undefined) return { window: snapshot, leftOut: 0 };
  const { windows, leftOut } = leaveOutDuplicates(
    [{ ...snapshot, tabs: picked }],
    already
  );
  const kept = new Set(windows[0]?.tabs.map((t) => t.tabId));
  const pickedIds = new Set(picked.map((t) => t.tabId));
  const tabs = snapshot.tabs.filter(
    (t) => !pickedIds.has(t.tabId) || kept.has(t.tabId)
  );
  // A Chrome group whose every tab was left out goes too; one that was always empty is not ours to prune.
  const { chromeTabGroups, ...rest } = snapshot;
  const groups = chromeTabGroups?.filter(
    (g) =>
      tabs.some((t) => t.chromeGroupId === g.groupId) ||
      !snapshot.tabs.some((t) => t.chromeGroupId === g.groupId)
  );
  return {
    window: {
      ...rest,
      tabs,
      tabCount: tabs.length,
      ...(groups && groups.length > 0 ? { chromeTabGroups: groups } : {}),
    },
    leftOut,
  };
}
