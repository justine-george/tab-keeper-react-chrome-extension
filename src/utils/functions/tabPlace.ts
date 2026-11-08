// Where an open tab is, as Chrome reports it, read for Open now's moves and their undo (KAN-280 Part E). A leaf
// module: openNowMoves and moveToNewWindow both read places here, and neither imports the other for it (KAN-950).
import { sanitizeTabGroupColor } from './tabGroups';
import type { TabGroupColor } from './tabGroups';

export interface GroupLook {
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

// Where a tab is, as Chrome reports it. `groupId` is Chrome's id, -1 when
// ungrouped (readable without the tabGroups grant). `group` is that group's
// look, read at the same moment: null when the tab is ungrouped or the grant
// is missing.
export interface TabPlace {
  windowId: number;
  index: number;
  groupId: number;
  group: GroupLook | null;
  // KAN-814. A drop can pin or unpin, so undo puts the pin back too.
  pinned: boolean;
}

export interface MovedTab {
  tabId: number;
  before: TabPlace;
  after: TabPlace;
}

export type MovedTabs = readonly MovedTab[];

// chrome.tabGroups.TAB_GROUP_ID_NONE, spelled out: chrome.tabGroups is absent
// without the grant, and tab.groupId still reports -1 then.
const NO_GROUP = -1;

// A Chrome call that rejected, or threw before it could.
const REFUSED = Symbol('refused');

async function attempt<T>(call: () => Promise<T>): Promise<T | typeof REFUSED> {
  try {
    return await call();
  } catch {
    return REFUSED;
  }
}

// The fields of a chrome.tabs.Tab this module reads, copied out at once: the
// object a call resolves with is not promised to stay as it was.
export interface TabState {
  windowId: number;
  index: number;
  groupId: number;
  pinned: boolean;
  active: boolean;
}

export async function readTab(tabId: number): Promise<TabState | null> {
  // Chrome rejects for a closed tab; the annotation admits `undefined` too,
  // so a resolve with nothing is a refusal here, not a crash.
  const tab: chrome.tabs.Tab | undefined | typeof REFUSED = await attempt(() =>
    chrome.tabs.get(tabId)
  );
  if (tab === REFUSED || tab === undefined) return null;
  return {
    windowId: tab.windowId,
    index: tab.index,
    groupId: tab.groupId,
    pinned: tab.pinned,
    active: tab.active,
  };
}

// A group's look, read with tabGroups.get: null for no group, or when the
// look is not to be read (the grant is missing); REFUSED when Chrome refuses.
async function readLook(
  groupId: number,
  withLook: boolean
): Promise<GroupLook | null | typeof REFUSED> {
  if (!withLook || groupId === NO_GROUP) return null;
  const group = await attempt(() => chrome.tabGroups.get(groupId));
  if (group === REFUSED) return REFUSED;
  return {
    title: group.title ?? '',
    color: sanitizeTabGroupColor(group.color),
    collapsed: group.collapsed,
  };
}

export async function placeOf(
  tab: TabState,
  withLook: boolean
): Promise<TabPlace | null> {
  const group = await readLook(tab.groupId, withLook);
  if (group === REFUSED) return null;
  return {
    windowId: tab.windowId,
    index: tab.index,
    groupId: tab.groupId,
    group,
    pinned: tab.pinned,
  };
}

// Where a tab is now, with its group's look when `withLook`. Null when Chrome
// refuses either read.
export async function readPlace(
  tabId: number,
  withLook: boolean
): Promise<TabPlace | null> {
  const tab = await readTab(tabId);
  return tab === null ? null : placeOf(tab, withLook);
}
