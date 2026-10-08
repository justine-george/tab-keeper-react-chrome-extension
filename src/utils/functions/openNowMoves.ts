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

// Where a drop at visible row `toIndex` lands in Chrome's strip.
//
// A slot as it stands: right before the row now at toIndex, else right after
// the last row (ledger R4). Through the rows' real indices, never by counting
// rows, because hidden Tab Keeper pages sit between them. `rows` leaves out
// the row being moved.
//
// `standsAt` is where the moving row's first tab stands, when it is in this
// window (null when it comes from another). If it already lies in the gap the
// drop names -- after the row before toIndex, before the row at it -- the drop
// is in place and nothing is to move: "before the next row" would carry it
// across a hidden page between it and that row (Task 6b review, Important 1).
//
// Null for a toIndex outside [0, rows].
type Landing = { inPlace: true } | { inPlace: false; slot: number };

function landingOf(
  rows: readonly RowSpan[],
  toIndex: number,
  standsAt: number | null
): Landing | null {
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > rows.length) {
    return null;
  }
  const previous = rows[toIndex - 1];
  const next = rows[toIndex];
  if (
    standsAt !== null &&
    (previous === undefined || previous.last < standsAt) &&
    (next === undefined || standsAt < next.first)
  ) {
    return { inPlace: true };
  }
  if (next !== undefined) return { inPlace: false, slot: next.first };
  return previous === undefined
    ? null
    : { inPlace: false, slot: previous.last + 1 };
}

// A landing no earlier than the end of `windowId`'s pinned run as Chrome has
// it now, for a tab or group that is not pinned (spec O11c: it lands below
// the line). The engine's landingRange already keeps an unfolded drop below
// the VISIBLE pinned tabs, so for those this changes nothing. It matters
// where the visible rows don't reach the run's end: a folded window, which
// draws no rows and so takes index 0, and a hidden pinned Tab Keeper page,
// which the snapshot leaves out. Chrome refuses a group there (Task 1 Q3)
// and only clamps a tab. Pinned tabs come first in a window, so the run ends
// at the count of pinned tabs. Null when Chrome won't list the window.
async function belowPinnedRun(
  windowId: number,
  landing: { inPlace: false; slot: number }
): Promise<Landing | null> {
  const strip = await attempt(() => chrome.tabs.query({ windowId }));
  if (strip === REFUSED) return null;
  const runEnd = strip.filter((tab) => tab.pinned).length;
  return { inPlace: false, slot: Math.max(landing.slot, runEnd) };
}

// A slot as it stands, as the index Chrome takes for a move within one
// window: the FINAL index, counted with the moving tabs removed (Task 1 Q1
// for tabs.move, Q3 for tabGroups.move). `first` and `count` are the moving
// run's first index and length.
function finalIndex(slot: number, first: number, count: number): number {
  return first < slot ? slot - count : slot;
}

// One tab into a group in another window, at `index` of the group's window
// counted without the tab (a final index). One tabs.move into another
// window's run is refused (Task 1 Q3), so the tab joins first -- tabs.group
// carries it to the END of the run, in the group's window -- and then moves
// within that window. False when Chrome refuses a step; the tab stays
// wherever Chrome left it.
async function joinAcross(
  tabId: number,
  groupId: number,
  index: number
): Promise<boolean> {
  const joined = await attempt(() =>
    chrome.tabs.group({ groupId, tabIds: [tabId] })
  );
  if (joined === REFUSED) return false;
  const landed = await readTab(tabId);
  if (landed === null) return false;
  if (landed.index === index) return true;
  const placed = await attempt(() => chrome.tabs.move(tabId, { index }));
  return placed !== REFUSED;
}

// The group run `slot` lies strictly inside, in `windowId`'s strip as Chrome
// has it now: the tabs either side of the slot are in one group. `start` is
// the run's first index. `{ inside: false }` when the slot is not inside a
// run; null when Chrome won't list the window. tabs.query reports groupId
// without the tabGroups grant (Task 6a Q3), and hidden Tab Keeper pages are
// in the strip, so a run they start or end is seen whole.
type RunAround =
  { inside: false } | { inside: true; groupId: number; start: number };

const NOT_INSIDE: RunAround = { inside: false };

async function groupRunAround(
  windowId: number,
  slot: number
): Promise<RunAround | null> {
  const strip = await attempt(() => chrome.tabs.query({ windowId }));
  if (strip === REFUSED) return null;
  const groupAt = (index: number) =>
    strip.find((tab) => tab.index === index)?.groupId;
  const groupId = groupAt(slot - 1);
  if (groupId === undefined || groupId === NO_GROUP) return NOT_INSIDE;
  if (groupAt(slot) !== groupId) return NOT_INSIDE;
  let start = slot - 1;
  while (groupAt(start - 1) === groupId) start -= 1;
  return { inside: true, groupId, start };
}

// One tab to the visible row `move.toIndex` of `move.toWindowId`.
//
// With the grant (`hasTabGroups`), the tab ends in the group whose band the
// release landed in (`move.toGroupId`), or in none: Chrome's own join rule
// ("strictly inside a run", Task 1 Q3) differs from the band's at a run's head
// and tail, so the group is set right after the move (ledger R16). Without the
// grant there are no bands; tabs.move is called, and Chrome's own join or
// leave stands (E4) -- except from another window into a group's run, which
// Chrome refuses as one tabs.move, so the tab joins with tabs.group first
// (KAN-322).
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
  const landing = landingOf(rows, move.toIndex, across ? null : held.index);
  if (landing === null) return null;

  // Chrome's own answer at drop time (ledger R3). A tab that has left the
  // window the snapshot put it in, moved within it, or been pinned since,
  // makes the snapshot's indices and the K1 check above stale: refused, and
  // the list re-reads (O11b).
  const now = await readTab(held.id);
  if (now === null || now.windowId !== from.id || now.index !== held.index) {
    return null;
  }
  if (across && now.pinned) return null;
  const before = await placeOf(now, hasTabGroups);
  if (before === null) return null;
  // A pinned tab stays within the run (landingRange, K1), so only an
  // unpinned one is kept below it.
  const target =
    landing.inPlace || held.pinned
      ? landing
      : await belowPinnedRun(to.id, landing);
  if (target === null) return null;

  if (target.inPlace) {
    // Already where the drop names; only its group may change, below.
  } else if (across && toGroupId !== NO_GROUP) {
    // The slot as it stood is its final index there: counted without the
    // tab, the strip is the one the slot was read from.
    if (!(await joinAcross(held.id, toGroupId, target.slot))) return null;
  } else {
    // Chrome's strip can put the slot inside a group's run where the preview
    // showed no band there:
    // - Without the grant a group's tabs draw as loose rows. Within a window
    //   Chrome joins the tab to that group itself; from another window one
    //   tabs.move there is refused (Task 1 Q3), so the tab joins the group
    //   the way a band drop does, at the same slot (KAN-322, spec O11e).
    // - With the grant and no band named, the preview showed the tab loose.
    //   That slot is inside the run only when a hidden Tab Keeper page is the
    //   run's first tab, so the tab lands before the whole run, loose: the
    //   run's head slot, where Chrome neither joins nor refuses (Task 1 Q3;
    //   KAN-322, ruling R34).
    const readRun = hasTabGroups ? toGroupId === NO_GROUP : across;
    const run = readRun ? await groupRunAround(to.id, target.slot) : NOT_INSIDE;
    if (run === null) return null;
    if (run.inside && !hasTabGroups) {
      if (!(await joinAcross(held.id, run.groupId, target.slot))) return null;
    } else {
      const slot = run.inside ? run.start : target.slot;
      const moved = await attempt(() =>
        across
          ? chrome.tabs.move(held.id, { windowId: to.id, index: slot })
          : chrome.tabs.move(held.id, {
              index: finalIndex(slot, held.index, 1),
            })
      );
      if (moved === REFUSED) return null;
    }
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

// G1 (spec O11g, Task 6a Q1): a group's tabs to another window by tabs.move
// -- each arrives behind, so the destination's front tab stays -- grouped
// again there, with `look` put back. The new group has a new id. `slot` is
// the destination's slot as it stands; `ids` are in strip order. False when
// Chrome refuses a step: an array tabs.move is not atomic (Task 6a Q1), so
// the tabs stay wherever Chrome left them.
async function moveAsNewGroup(
  ids: [number, ...number[]],
  windowId: number,
  slot: number,
  look: GroupLook
): Promise<boolean> {
  const moved = await attempt(() =>
    chrome.tabs.move(ids, { windowId, index: slot })
  );
  if (moved === REFUSED) return false;
  // createProperties.windowId, or Chrome makes the group in the CURRENT
  // window and moves the tabs there (Task 6a Q3). The order of tabIds is
  // unmeasured and harmless: the tabs.move above has just put them side by
  // side in that order.
  const newId = await attempt(() =>
    chrome.tabs.group({ tabIds: ids, createProperties: { windowId } })
  );
  if (newId === REFUSED) return false;
  return restyle(newId, look);
}

// A group given `look`'s title, colour and collapsed state. False when
// Chrome refuses.
async function restyle(groupId: number, look: GroupLook): Promise<boolean> {
  const restyled = await attempt(() =>
    chrome.tabGroups.update(groupId, {
      title: look.title,
      color: look.color,
      collapsed: look.collapsed,
    })
  );
  return restyled !== REFUSED;
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
  if (!group || !from || !to) return null;
  const across = to.id !== from.id;
  // Refused before any call (ledger R15, O11d). No pinned rule: a pinned tab
  // is never in a group.
  if (across && from.incognito !== to.incognito) return null;

  // The group's listed tabs in the snapshot; the first is where it stands.
  // None when the group is not in `from`: refused.
  const listed = from.tabs.filter((tab) => tab.groupId === group.id);
  const standsAt = listed[0]?.index;
  if (standsAt === undefined) return null;
  const landing = landingOf(
    topLevelRows(to, group.id),
    move.toIndex,
    across ? null : standsAt
  );
  if (landing === null) return null;

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
  // Every listed tab still in the group, where the snapshot put it -- else the
  // strip changed under the drag hold and the snapshot's slot can't be placed
  // honestly: refused, and the list re-reads (O11b).
  const stale = listed.some(
    (tab) =>
      members.find((member) => member.id === tab.id)?.state.index !== tab.index
  );
  if (stale) return null;
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
  // A group is never pinned, so it is always kept below the run.
  const target = landing.inPlace
    ? landing
    : await belowPinnedRun(to.id, landing);
  if (target === null) return null;

  if (target.inPlace) {
    // Already where the drop names: nothing moves.
  } else if (!across) {
    const index = finalIndex(target.slot, head.state.index, members.length);
    const moved = await attempt(() =>
      chrome.tabGroups.move(group.id, { index })
    );
    if (moved === REFUSED) return null;
  } else if (!members.some((member) => member.state.active)) {
    const { slot } = target;
    const moved = await attempt(() =>
      chrome.tabGroups.move(group.id, { windowId: to.id, index: slot })
    );
    if (moved === REFUSED) return null;
  } else {
    // G1. Any step Chrome refuses ends the move where Chrome left it, with no
    // record (ledger R17).
    if (!(await moveAsNewGroup(ids, to.id, target.slot, look))) return null;
  }

  const result: { tabId: number; before: TabPlace; after: TabPlace }[] = [];
  for (const { tabId, before } of befores) {
    const after = await readPlace(tabId, true);
    if (after === null) return null;
    result.push({ tabId, before, after });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Undo (spec O11f, U1): ⌘Z / Ctrl+Z puts an Open now drop's tabs back.

// One drop as ⌘Z undoes it: moveOpenTab's record (`kind: 'tab'`, one tab,
// put back on its own) or moveOpenGroup's (`kind: 'group'`, every tab of the
// group, put back as one group).
export interface OpenNowDrop {
  kind: 'tab' | 'group';
  moved: MovedTabs;
}

// Whether a drop's record changed any tab's window, index or group (ledger
// R23). A drop in place records before == after for every tab; a tab can
// join or leave a group without its index changing, so the group counts.
export function changedAnyPlace(moved: MovedTabs): boolean {
  return moved.some(
    ({ before, after }) =>
      before.windowId !== after.windowId ||
      before.index !== after.index ||
      before.groupId !== after.groupId
  );
}

// What an undo did: 'undone', every tab back; 'stale', nothing, because a
// tab is no longer where the drop left it (moved or closed outside Tab
// Keeper); 'refused', Chrome refused a step part way, and the tabs are
// wherever Chrome left them.
export type UndoOutcome = 'undone' | 'stale' | 'refused';

// Each recorded tab as Chrome has it now, when every one is still where the
// drop left it (its `after` window, index and group, ledger R14); null when
// any has moved, been regrouped or closed since. A tab regrouped by hand in
// place is not where the drop left it: putting it back would ungroup it and
// can remove the group the user made (KAN-323). tabs.get reports groupId
// without the tabGroups grant (Task 6a Q3). Hidden Tab Keeper pages that
// moved with a group are in the record, so they are checked too.
async function whereTheDropLeftThem(
  moved: MovedTabs
): Promise<TabState[] | null> {
  const states: TabState[] = [];
  for (const { tabId, after } of moved) {
    const now = await readTab(tabId);
    if (
      now === null ||
      now.windowId !== after.windowId ||
      now.index !== after.index ||
      now.groupId !== after.groupId
    ) {
      return null;
    }
    states.push(now);
  }
  return states;
}

// Whether Chrome still has a group with this id: it removes a group when its
// last tab leaves (Task 6a), so a group exists while some tab is in it.
// tabs.query answers without the tabGroups grant (Task 6a Q3), where
// tabGroups.get does not exist. REFUSED when Chrome refuses the read.
async function groupExists(groupId: number): Promise<boolean | typeof REFUSED> {
  const all = await attempt(() => chrome.tabs.query({}));
  if (all === REFUSED) return REFUSED;
  return all.some((tab) => tab.groupId === groupId);
}

// The group a tab goes back into: the one it had while Chrome still has it
// ('rejoin'); a new one with the recorded look when Chrome removed it and the
// look can be set ('rebuild', settled A); else none.
type GroupBack =
  | { kind: 'none' }
  | { kind: 'rejoin'; groupId: number }
  | { kind: 'rebuild'; look: GroupLook };

async function groupBackFor(
  before: TabPlace,
  withLook: boolean
): Promise<GroupBack | null> {
  if (before.groupId === NO_GROUP) return { kind: 'none' };
  const exists = await groupExists(before.groupId);
  if (exists === REFUSED) return null;
  if (exists) return { kind: 'rejoin', groupId: before.groupId };
  return withLook && before.group !== null
    ? { kind: 'rebuild', look: before.group }
    : { kind: 'none' };
}

// One tab back to its `before` window, index and group. `now` is where it
// is. The index is `before.index` both ways: within a window Chrome takes a
// final index (Task 1 Q1), and across windows a slot as it stands in a strip
// that is the old one without the tab, so the same number. The group is set
// after the move, as a drop sets it (ledger R16): Chrome's own join rule may
// have joined or left one on the way.
async function putTabBack(
  { tabId, before }: MovedTab,
  now: TabState,
  withLook: boolean
): Promise<boolean> {
  const back = await groupBackFor(before, withLook);
  if (back === null) return false;
  const across = now.windowId !== before.windowId;

  if (across && back.kind === 'rejoin') {
    if (!(await joinAcross(tabId, back.groupId, before.index))) return false;
  } else if (across || now.index !== before.index) {
    const moved = await attempt(() =>
      across
        ? chrome.tabs.move(tabId, {
            windowId: before.windowId,
            index: before.index,
          })
        : chrome.tabs.move(tabId, { index: before.index })
    );
    if (moved === REFUSED) return false;
  }

  const landed = await readTab(tabId);
  if (landed === null) return false;
  if (back.kind === 'rebuild') {
    // createProperties.windowId, or Chrome makes the group in the CURRENT
    // window and moves the tab there (Task 6a Q3).
    const newId = await attempt(() =>
      chrome.tabs.group({
        tabIds: [tabId],
        createProperties: { windowId: landed.windowId },
      })
    );
    return newId !== REFUSED && restyle(newId, back.look);
  }
  const groupId = back.kind === 'rejoin' ? back.groupId : NO_GROUP;
  if (landed.groupId !== groupId) {
    const set = await attempt<unknown>(() =>
      groupId === NO_GROUP
        ? chrome.tabs.ungroup(tabId)
        : chrome.tabs.group({ groupId, tabIds: [tabId] })
    );
    if (set === REFUSED) return false;
  }
  if (back.kind === 'rejoin' && withLook && before.group !== null) {
    const { collapsed } = before.group;
    const restored = await attempt(() =>
      chrome.tabGroups.update(back.groupId, { collapsed })
    );
    if (restored === REFUSED) return false;
  }
  return true;
}

// A whole group back to its `before` window and index, as one group. The
// group is the one its tabs are in now (`after.groupId`: the same id, or G1's
// new one). Within a window, and back to another window when the group holds
// no front tab: tabGroups.move, keeping the id. When it does hold its
// window's front tab, G1 as for a drop (ledger R24): the tabs move with
// tabs.move and are grouped again with the recorded look. The index is the
// group's old first index, for the same reason as putTabBack's.
async function putGroupBack(
  moved: MovedTabs,
  states: readonly TabState[]
): Promise<boolean> {
  const ordered = [...moved].sort((a, b) => a.after.index - b.after.index);
  const head = ordered[0];
  if (head === undefined) return false;
  const look = head.before.group;
  if (look === null) return false;
  const groupId = head.after.groupId;
  const home = head.before.windowId;
  const index = Math.min(...moved.map((tab) => tab.before.index));
  const across = head.after.windowId !== home;
  const ids: [number, ...number[]] = [
    head.tabId,
    ...ordered.slice(1).map((tab) => tab.tabId),
  ];

  if (across && states.some((state) => state.active)) {
    return moveAsNewGroup(ids, home, index, look);
  }
  const back = await attempt(() =>
    across
      ? chrome.tabGroups.move(groupId, { windowId: home, index })
      : chrome.tabGroups.move(groupId, { index })
  );
  if (back === REFUSED) return false;
  const { collapsed } = look;
  const restored = await attempt(() =>
    chrome.tabGroups.update(groupId, { collapsed })
  );
  return restored !== REFUSED;
}

// ⌘Z for one drop. Never throws. Checks first that every recorded tab is
// still where the drop left it, and does nothing when one is not (moved or
// closed outside Tab Keeper, spec O11f). A step Chrome refuses part way ends
// the undo there; the tabs stay wherever Chrome left them, and Open now's
// live read shows it.
export async function undoOpenNowDrop(
  drop: OpenNowDrop,
  hasTabGroups: boolean
): Promise<UndoOutcome> {
  const states = await whereTheDropLeftThem(drop.moved);
  if (states === null) return 'stale';
  // The look is only read or set with the grant, and chrome.tabGroups is
  // absent without it.
  const withLook = hasTabGroups && Boolean(chrome.tabGroups);

  if (drop.kind === 'group') {
    if (!withLook) return 'refused';
    return (await putGroupBack(drop.moved, states)) ? 'undone' : 'refused';
  }
  for (const [i, tab] of drop.moved.entries()) {
    const now = states[i];
    if (now === undefined || !(await putTabBack(tab, now, withLook))) {
      return 'refused';
    }
  }
  return 'undone';
}
