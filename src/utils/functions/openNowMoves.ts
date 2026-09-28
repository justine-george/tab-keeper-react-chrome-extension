// The Chrome calls a committed Open now drop makes (KAN-280 Part E). DOM-free:
// it takes the drop the drag engine described (TabMove / GroupMove, string
// ids) and the snapshot the pane drew, and moves the real tabs.
//
// Every measured rule cited here is in docs/superpowers/plans/
// 2026-09-28-open-now-part-e.md, "Task 1 results" and its "### Task 6a".
//
// Neither function throws. Each returns null when it refuses a move itself, or
// when any Chrome call is refused (a tab closed meanwhile, say) -- and then
// leaves the tabs wherever Chrome has them, with no undo record (ledger R17).
// Otherwise it returns every moved tab's place before and after the move.
import type {
  GroupMove,
  TabMove,
} from '../../components/home/rightpane/rowDrag/dropRules';
import type { OpenTab, OpenWindow } from './openNow';
import { partitionTabsIntoItems, sanitizeTabGroupColor } from './tabGroups';
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
}

export type MovedTabs = readonly {
  tabId: number;
  before: TabPlace;
  after: TabPlace;
}[];

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
interface TabState {
  windowId: number;
  index: number;
  groupId: number;
  pinned: boolean;
  active: boolean;
}

async function readTab(tabId: number): Promise<TabState | null> {
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

async function placeOf(
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
  };
}

// Where a tab is now, with its group's look when `withLook`. Null when Chrome
// refuses either read.
async function readPlace(
  tabId: number,
  withLook: boolean
): Promise<TabPlace | null> {
  const tab = await readTab(tabId);
  return tab === null ? null : placeOf(tab, withLook);
}

// The snapshot's windows and tabs by the string ids the drag engine carries
// (ledger R2): never Number() or parseInt on an id, so an unknown id is a
// miss, not NaN.
function indexSnapshot(windows: readonly OpenWindow[]) {
  const windowById = new Map<string, OpenWindow>();
  const tabById = new Map<string, OpenTab>();
  const groupById = new Map<string, { id: number; windowId: number }>();
  for (const window of windows) {
    windowById.set(String(window.id), window);
    for (const tab of window.tabs) tabById.set(String(tab.id), tab);
    for (const group of window.groups) {
      groupById.set(String(group.id), { id: group.id, windowId: window.id });
    }
  }
  return { windowById, tabById, groupById };
}

// A row as Chrome's strip holds it: the indices of its first and last tab.
interface RowSpan {
  first: number;
  last: number;
}

// A drop at visible row `toIndex`, as a slot in Chrome's strip as it stands:
// right before the row now at toIndex, else right after the last row (ledger
// R4). Through the rows' real indices, never by counting rows, because hidden
// Tab Keeper pages sit between them. `rows` leaves out the row being moved;
// when that was its window's only row, the drop is in place, at `inPlace`
// (where the row stands). Null for a toIndex outside [0, rows].
function slotBefore(
  rows: readonly RowSpan[],
  toIndex: number,
  inPlace: number
): number | null {
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > rows.length) {
    return null;
  }
  const at = rows[toIndex];
  if (at !== undefined) return at.first;
  const last = rows[rows.length - 1];
  return last === undefined ? inPlace : last.last + 1;
}

// A slot as it stands, as the index Chrome takes for a move within one
// window: the FINAL index, counted with the moving tabs removed (Task 1 Q1
// for tabs.move, Q3 for tabGroups.move). `first` and `count` are the moving
// run's first index and length.
function finalIndex(slot: number, first: number, count: number): number {
  return first < slot ? slot - count : slot;
}

// One tab to the visible row `move.toIndex` of `move.toWindowId`.
//
// With the grant (`hasTabGroups`), the tab ends in the group whose band the
// release landed in (`move.toGroupId`), or in none: Chrome's own join rule
// ("strictly inside a run", Task 1 Q3) differs from the band's at a run's head
// and tail, so the group is set right after the move (ledger R16). Without the
// grant there are no bands; only tabs.move is called, and Chrome's own join or
// leave stands (E4).
export async function moveOpenTab(
  move: TabMove,
  windows: readonly OpenWindow[],
  hasTabGroups: boolean
): Promise<MovedTabs | null> {
  const { windowById, tabById, groupById } = indexSnapshot(windows);
  const held = tabById.get(move.tabId);
  const from = windowById.get(move.fromWindowId);
  const to = windowById.get(move.toWindowId);
  if (!held || !from || !to || held.windowId !== from.id) return null;
  const across = to.id !== from.id;
  // Refused here too, before any call, whatever the caller checked (ledger
  // R15): Chrome UNPINS a pinned tab moved to another window (K1, Task 1 Q2),
  // and rejects a move between profiles (O11d, Task 1 Q4).
  if (across && (held.pinned || from.incognito !== to.incognito)) return null;

  // The group the tab must end in. A band names one of the destination's
  // groups; any other name is refused.
  let toGroupId = NO_GROUP;
  if (hasTabGroups && move.toGroupId !== undefined) {
    const group = groupById.get(move.toGroupId);
    if (!group || group.windowId !== to.id) return null;
    // A pinned tab is never in a group, and what tabs.group does to one is
    // unmeasured; a drag never pins or unpins (spec O11a).
    if (held.pinned) return null;
    toGroupId = group.id;
  }

  const rows = to.tabs
    .filter((tab) => tab.id !== held.id)
    .map((tab) => ({ first: tab.index, last: tab.index }));
  const slot = slotBefore(rows, move.toIndex, held.index);
  if (slot === null) return null;

  // Chrome's own answer at drop time (ledger R3). A tab that has left the
  // window the snapshot put it in, or been pinned since, makes the snapshot's
  // indices and the K1 check above stale: refused.
  const now = await readTab(held.id);
  if (now === null || now.windowId !== from.id) return null;
  if (across && now.pinned) return null;
  const before = await placeOf(now, hasTabGroups);
  if (before === null) return null;

  if (across && toGroupId !== NO_GROUP) {
    // One tabs.move into another window's run is refused (Task 1 Q3), so the
    // tab joins first -- tabs.group carries it to the END of the run, in the
    // group's window -- and then moves within that window. The slot as it
    // stood is its final index there: counted without the tab, the strip is
    // the one the slot was read from.
    const joined = await attempt(() =>
      chrome.tabs.group({ groupId: toGroupId, tabIds: [held.id] })
    );
    if (joined === REFUSED) return null;
    const landed = await readTab(held.id);
    if (landed === null) return null;
    if (landed.index !== slot) {
      const placed = await attempt(() =>
        chrome.tabs.move(held.id, { index: slot })
      );
      if (placed === REFUSED) return null;
    }
  } else {
    const moved = await attempt(() =>
      across
        ? chrome.tabs.move(held.id, { windowId: to.id, index: slot })
        : chrome.tabs.move(held.id, { index: finalIndex(slot, held.index, 1) })
    );
    if (moved === REFUSED) return null;
  }

  if (hasTabGroups) {
    const landed = await readTab(held.id);
    if (landed === null) return null;
    if (landed.groupId !== toGroupId) {
      const set = await attempt<unknown>(() =>
        toGroupId === NO_GROUP
          ? chrome.tabs.ungroup(held.id)
          : chrome.tabs.group({ groupId: toGroupId, tabIds: [held.id] })
      );
      if (set === REFUSED) return null;
    }
  }

  const after = await readPlace(held.id, hasTabGroups);
  if (after === null) return null;
  return [{ tabId: held.id, before, after }];
}

// A window's top-level rows as Open now draws them -- a loose or pinned tab is
// one row, a group is one row (the same partition the pane and the drag
// engine use, KAN-131) -- without the group being moved.
function topLevelRows(window: OpenWindow, heldGroupId: number): RowSpan[] {
  const items = partitionTabsIntoItems(
    window.tabs.map((tab) => ({
      tabId: String(tab.id),
      chromeGroupId: tab.groupId === null ? undefined : String(tab.groupId),
      index: tab.index,
    })),
    window.groups.map((group) => ({
      groupId: String(group.id),
      title: group.title,
      color: group.color,
    }))
  );
  return items.flatMap((item) => {
    if (item.kind === 'tab') {
      return [{ first: item.tab.index, last: item.tab.index }];
    }
    if (item.group.groupId === String(heldGroupId)) return [];
    const indices = item.tabs.map((tab) => tab.index);
    return [{ first: Math.min(...indices), last: Math.max(...indices) }];
  });
}

// A tab Chrome listed with an id, which every tab in a window's strip has;
// chrome.tabs.Tab only types it optional because a Session's tab has none.
function hasId(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
  return typeof tab.id === 'number';
}

// A whole group to the top-level row `move.toIndex` of `move.toWindowId`.
// Needs the tabGroups grant: without it no group is shown to be dragged.
//
// Within a window, and to another window when the group does not hold its
// window's front tab: tabGroups.move, which keeps the group's id. When it
// does hold the front tab, tabGroups.move would make that tab the
// destination's front tab (Task 1 Q5), so the tabs move with tabs.move (each
// arrives behind), are grouped again in the destination, and get the old
// title, colour and collapsed state back (G1, spec O11g, Task 6a Q1). That
// group has a NEW id, which `after.groupId` carries (ledger R14).
export async function moveOpenGroup(
  move: GroupMove,
  windows: readonly OpenWindow[]
): Promise<MovedTabs | null> {
  if (!chrome.tabGroups) return null;
  const { windowById, groupById } = indexSnapshot(windows);
  const group = groupById.get(move.groupId);
  const from = windowById.get(move.fromWindowId);
  const to = windowById.get(move.toWindowId);
  if (!group || !from || !to || group.windowId !== from.id) return null;
  const across = to.id !== from.id;
  // Refused before any call (ledger R15, O11d). No pinned rule: a pinned tab
  // is never in a group.
  if (across && from.incognito !== to.incognito) return null;

  // Where the group stands in the snapshot: its first listed tab.
  const stands = Math.min(
    ...from.tabs.filter((tab) => tab.groupId === group.id).map((t) => t.index)
  );
  const slot = slotBefore(topLevelRows(to, group.id), move.toIndex, stands);
  if (slot === null) return null;

  // The group's tabs as Chrome has them at drop time (ledger R3), hidden Tab
  // Keeper pages in it included: they move with it, so they are counted and
  // recorded too.
  const strip = await attempt(() => chrome.tabs.query({ windowId: from.id }));
  if (strip === REFUSED) return null;
  const members = strip
    .filter(hasId)
    .filter((tab) => tab.groupId === group.id)
    .map((tab) => ({
      id: tab.id,
      state: {
        windowId: tab.windowId,
        index: tab.index,
        groupId: tab.groupId,
        pinned: tab.pinned,
        active: tab.active,
      },
    }))
    .sort((a, b) => a.state.index - b.state.index);
  const head = members[0];
  if (head === undefined) return null;
  // Non-empty, as tabs.group's tabIds must be.
  const ids: [number, ...number[]] = [
    head.id,
    ...members.slice(1).map((member) => member.id),
  ];

  const befores: { tabId: number; before: TabPlace }[] = [];
  for (const member of members) {
    const before = await placeOf(member.state, true);
    if (before === null) return null;
    befores.push({ tabId: member.id, before });
  }
  const look = befores[0]?.before.group;
  if (!look) return null;

  if (!across) {
    const index = finalIndex(slot, head.state.index, members.length);
    const moved = await attempt(() =>
      chrome.tabGroups.move(group.id, { index })
    );
    if (moved === REFUSED) return null;
  } else if (!members.some((member) => member.state.active)) {
    const moved = await attempt(() =>
      chrome.tabGroups.move(group.id, { windowId: to.id, index: slot })
    );
    if (moved === REFUSED) return null;
  } else {
    // G1. Any step Chrome refuses ends the move where Chrome left it, with no
    // record (ledger R17): an array tabs.move is not atomic (Task 6a Q1).
    const moved = await attempt(() =>
      chrome.tabs.move(ids, { windowId: to.id, index: slot })
    );
    if (moved === REFUSED) return null;
    // createProperties.windowId, or Chrome makes the group in the CURRENT
    // window and moves the tabs there (Task 6a Q3).
    const newId = await attempt(() =>
      chrome.tabs.group({ tabIds: ids, createProperties: { windowId: to.id } })
    );
    if (newId === REFUSED) return null;
    const restyled = await attempt(() =>
      chrome.tabGroups.update(newId, {
        title: look.title,
        color: look.color,
        collapsed: look.collapsed,
      })
    );
    if (restyled === REFUSED) return null;
  }

  const result: { tabId: number; before: TabPlace; after: TabPlace }[] = [];
  for (const { tabId, before } of befores) {
    const after = await readPlace(tabId, true);
    if (after === null) return null;
    result.push({ tabId, before, after });
  }
  return result;
}
