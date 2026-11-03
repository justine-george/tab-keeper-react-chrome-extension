import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { resolveTabUrl } from './local';
import { leaveOutDuplicates } from './skipDuplicates';
import type { WindowSpec } from './windows';

// KAN-910. A window's pages: each address to the first live tab id that has it, in window order.
export type OpenPages = ReadonlyMap<string, number>;

type LiveTab = {
  id?: number;
  url?: string;
  pendingUrl?: string;
  index: number;
};

// A loading tab counts by where it is going; a tab with no id or no address is not an open copy.
export function openPagesOf(tabs: readonly LiveTab[]): OpenPages {
  const pages = new Map<string, number>();
  for (const t of [...tabs].sort((a, b) => a.index - b.index)) {
    if (t.id === undefined) continue;
    const address = resolveTabUrl(
      t.pendingUrl !== undefined && t.pendingUrl !== ''
        ? t.pendingUrl
        : (t.url ?? '')
    );
    if (address !== '' && !pages.has(address)) pages.set(address, t.id);
  }
  return pages;
}

// The id of the live tab that already shows this saved tab's page.
export function openCopyOf(tab: tabData, open: OpenPages): number | undefined {
  return open.get(resolveTabUrl(tab.url));
}

// Judged on the page each tab opens, so the saved addresses stay as saved.
function leaveOut(
  tabs: readonly tabData[],
  already: ReadonlySet<string>
): { kept: tabData[]; left: tabData[] } {
  const judged = tabs.map((t) => ({ ...t, url: resolveTabUrl(t.url) }));
  const { windows } = leaveOutDuplicates(
    [
      {
        windowId: '',
        windowHeight: 0,
        windowWidth: 0,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: judged.length,
        title: '',
        tabs: judged,
      },
    ],
    already
  );
  const keptIds = new Set(windows[0]?.tabs.map((t) => t.tabId));
  return {
    kept: tabs.filter((t) => keptIds.has(t.tabId)),
    left: tabs.filter((t) => !keptIds.has(t.tabId)),
  };
}

// Open copies standing in for left-out tabs, in saved order; a tab that only repeated an earlier saved tab has none.
function copiesFor(left: readonly tabData[], open: OpenPages): number[] {
  const ids = new Set<number>();
  for (const t of left) {
    const id = openCopyOf(t, open);
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

export function leaveOutOpenTabs(
  tabs: readonly tabData[],
  open: OpenPages
): { tabs: tabData[]; leftOut: number; alreadyOpen: number[] } {
  const { kept, left } = leaveOut(tabs, new Set(open.keys()));
  return {
    tabs: kept,
    leftOut: left.length,
    alreadyOpen: copiesFor(left, open),
  };
}

// One seen-set runs through every spec, so a page in two saved windows opens once.
export function leaveOutOpenSpecs(
  specs: readonly WindowSpec[],
  open: OpenPages
): { specs: WindowSpec[]; leftOut: number; alreadyOpen: number[] } {
  const seen = new Set(open.keys());
  const out: WindowSpec[] = [];
  const left: tabData[] = [];
  for (const spec of specs) {
    const result = leaveOut(spec.tabs, seen);
    left.push(...result.left);
    for (const t of result.kept) seen.add(resolveTabUrl(t.url));
    if (result.left.length === 0) {
      out.push(spec);
      continue;
    }
    if (result.kept.length === 0) continue;
    const { groups, activeTabId, ...rest } = spec;
    const keptGroups = groups?.filter((g) =>
      result.kept.some((t) => t.chromeGroupId === g.groupId)
    );
    out.push({
      ...rest,
      tabs: result.kept,
      ...(keptGroups !== undefined && keptGroups.length > 0
        ? { groups: keptGroups }
        : {}),
      ...(activeTabId !== undefined &&
      result.kept.some((t) => t.tabId === activeTabId)
        ? { activeTabId }
        : {}),
    });
  }
  return {
    specs: out,
    leftOut: left.length,
    alreadyOpen: copiesFor(left, open),
  };
}
