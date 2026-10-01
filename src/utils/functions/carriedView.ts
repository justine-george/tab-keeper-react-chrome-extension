// KAN-350. What the saved detail draws while something is carried.
import type {
  CarriedRef,
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { groupItemIdOf, partitionTabsIntoRuns } from './tabGroups';
import { NEW_LAST_WINDOW } from '../../components/home/rightpane/newWindowTarget';

// A session as the detail draws it: its id and its windows, with nothing that
// states a size. The counts are left out on purpose -- a view with an item
// taken out would carry the stored counts, which no longer describe it.
// Structurally a PaneWindows, so the drag areas take it as they are.
export type ShownSession = Pick<tabContainerData, 'tabGroupId' | 'windows'>;

// A window with the carried tab or group taken out. A group left with no tabs
// loses its entry, as the move reducer prunes it. The window itself stays,
// however empty: its header shows until the drop (plan Decision).
function windowWithout(
  w: windowGroupData,
  carried: Exclude<CarriedRef, { kind: 'window' }>
): windowGroupData {
  const tabs =
    carried.kind === 'tab'
      ? w.tabs.filter((t) => t.tabId !== carried.tabId)
      : w.tabs.filter((t) => t.chromeGroupId !== carried.groupId);
  if (tabs.length === w.tabs.length) return w;
  const chromeTabGroups = w.chromeTabGroups?.filter((g) =>
    tabs.some((t) => t.chromeGroupId === g.groupId)
  );
  return {
    ...w,
    tabs,
    ...(chromeTabGroups === undefined ? {} : { chromeTabGroups }),
  };
}

/**
 * The session `shownId` names, as the detail draws it while `carried` is
 * carried: the carried item left out when this session is its source, so the
 * list closes up behind it (mock step 1).
 *
 * Returns the stored session object itself whenever nothing is left out --
 * no carry, another session's item, or an item no longer there -- because the
 * drag areas re-bind their listeners whenever the session they are given
 * changes identity. Null when no session has that id.
 */
export function carriedView(
  tabGroups: readonly tabContainerData[],
  shownId: string | undefined,
  carried: CarriedRef | null
): ShownSession | null {
  const shown = tabGroups.find((g) => g.tabGroupId === shownId);
  if (shown === undefined) return null;
  if (carried === null || carried.tabGroupId !== shown.tabGroupId) {
    return shown;
  }

  let changed = false;
  const windows = shown.windows.flatMap((w) => {
    if (w.windowId !== carried.windowId) return [w];
    if (carried.kind === 'window') {
      changed = true;
      return [];
    }
    const without = windowWithout(w, carried);
    if (without !== w) changed = true;
    return [without];
  });
  return changed ? { tabGroupId: shown.tabGroupId, windows } : shown;
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

// What a phantom row's ids are made from: the carried item's own, prefixed,
// so the phantom is never the same row as the item -- which its source still
// has in the store, and which the source's list may still draw (Q2 A shows
// the target in the source too). The engine keys rows by id, and two rows
// under one key is one row to it. Distinct from NEW_LAST_WINDOW's prefix, so
// no carried window's phantom can be the window a tab or group rests in.
const PHANTOM_ID_PREFIX = 'carried:';
const phantomIdOf = (id: string) => `${PHANTOM_ID_PREFIX}${id}`;

/**
 * The id the phantom row a carried item is drawn as goes by, in the list that
 * drags its kind: a tab's in the `tabs` list, a group's item id in the
 * `items` list, a window's in the windows list. It is what the engine adopts.
 */
export function carriedRowId(carried: CarriedRef): string {
  switch (carried.kind) {
    case 'tab':
      return phantomIdOf(carried.tabId);
    case 'group':
      return groupItemIdOf(phantomIdOf(carried.groupId));
    case 'window':
      return phantomIdOf(carried.windowId);
  }
}

/**
 * The id the carried item's OWN row goes by in the list that drags its kind
 * -- the row the move puts it in, once it has landed. Not the phantom's
 * (carriedRowId): the phantom is gone once the carry ends.
 */
export function landedRowId(carried: CarriedRef): string {
  switch (carried.kind) {
    case 'tab':
      return carried.tabId;
    case 'group':
      return groupItemIdOf(carried.groupId);
    case 'window':
      return carried.windowId;
  }
}

// A window's tabs and groups under their phantom ids. A tab keeps its group,
// renamed with it.
function asPhantom(
  tabs: windowGroupData['tabs'],
  groups: NonNullable<windowGroupData['chromeTabGroups']>
): Pick<windowGroupData, 'tabs' | 'chromeTabGroups'> {
  return {
    tabs: tabs.map((t) => ({
      ...t,
      tabId: phantomIdOf(t.tabId),
      ...(t.chromeGroupId === undefined
        ? {}
        : { chromeGroupId: phantomIdOf(t.chromeGroupId) }),
    })),
    chromeTabGroups: groups.map((g) => ({
      ...g,
      groupId: phantomIdOf(g.groupId),
    })),
  };
}

// The window the phantom row stands in, read from the carried item's SOURCE:
// the carried window itself, or a new window holding the carried tab (loose,
// as a move to a new window leaves it) or group. The new window borrows its
// source window's bounds and takes no title, as the move reducer builds it.
// Every id in it is a phantom id. Null when the store no longer holds the
// item.
function phantomWindowOf(
  tabGroups: readonly tabContainerData[],
  carried: CarriedRef
): windowGroupData | null {
  const from = tabGroups
    .find((g) => g.tabGroupId === carried.tabGroupId)
    ?.windows.find((w) => w.windowId === carried.windowId);
  if (from === undefined) return null;
  if (carried.kind === 'window') {
    return {
      ...from,
      windowId: phantomIdOf(from.windowId),
      ...asPhantom(from.tabs, from.chromeTabGroups ?? []),
    };
  }

  const asNewWindow = (
    tabs: windowGroupData['tabs'],
    groups: NonNullable<windowGroupData['chromeTabGroups']>
  ): windowGroupData => ({
    ...from,
    windowId: NEW_LAST_WINDOW,
    title: '',
    tabCount: tabs.length,
    ...asPhantom(tabs, groups),
  });

  if (carried.kind === 'tab') {
    const tab = from.tabs.find((t) => t.tabId === carried.tabId);
    if (tab === undefined) return null;
    const loose = { ...tab };
    delete loose.chromeGroupId;
    return asNewWindow([loose], []);
  }
  // The SAME partition the screen draws and the move lifts (KAN-131).
  const run = partitionTabsIntoRuns(from.tabs, from.chromeTabGroups).find(
    (r) => r.kind === 'group' && r.group.groupId === carried.groupId
  );
  if (run === undefined || run.kind !== 'group') return null;
  return asNewWindow(run.tabs, [run.group]);
}

// Every window, tab and group id a list of windows holds.
function idsOf(windows: readonly windowGroupData[]): Set<string> {
  const ids = new Set<string>();
  for (const w of windows) {
    ids.add(w.windowId);
    for (const t of w.tabs) ids.add(t.tabId);
    for (const g of w.chromeTabGroups ?? []) ids.add(g.groupId);
  }
  return ids;
}

// The carried item's own ids, as the store holds them.
function carriedIdsIn(
  tabGroups: readonly tabContainerData[],
  carried: CarriedRef
): Set<string> {
  const from = tabGroups
    .find((g) => g.tabGroupId === carried.tabGroupId)
    ?.windows.find((w) => w.windowId === carried.windowId);
  if (from === undefined) return new Set();
  switch (carried.kind) {
    case 'window':
      return idsOf([from]);
    case 'tab':
      return new Set([carried.tabId]);
    case 'group':
      return new Set([
        carried.groupId,
        ...from.tabs
          .filter((t) => t.chromeGroupId === carried.groupId)
          .map((t) => t.tabId),
      ]);
  }
}

/**
 * The session `shownId` names, as the detail draws it while `carried` is
 * carried AND can land in it at an exact spot: carriedView's session, with
 * the carried item drawn as a PHANTOM the drag engine adopts -- a tab or
 * group inside a synthetic LAST window (NEW_LAST_WINDOW: the list's trailing
 * block, KAN-361/366), a window as the first window. Its rows go by phantom
 * ids (carriedRowId), never the item's own.
 *
 * Null when the session offers no exact spot: no session has that id, the
 * store no longer holds the carried item, or one of the item's ids is one
 * the session already holds -- duplicate ids from legacy data or an import
 * (Review Focus 4). The detail then draws carriedView's session with no
 * phantom, and a row drop still works: the move reducer re-mints colliding
 * ids.
 *
 * A new object on every call; the caller memoizes it for the carry.
 */
export function landingView(
  tabGroups: readonly tabContainerData[],
  shownId: string | undefined,
  carried: CarriedRef
): ShownSession | null {
  const shown = carriedView(tabGroups, shownId, carried);
  if (shown === null) return null;
  const phantom = phantomWindowOf(tabGroups, carried);
  if (phantom === null) return null;

  const held = idsOf(shown.windows);
  for (const id of carriedIdsIn(tabGroups, carried)) {
    if (held.has(id)) return null;
  }
  // A window's phantom is a window row, first. A tab's or group's rests in
  // the trailing block, after every window, so drawing it moves no row of
  // the session (KAN-361 N1 B: the New window target is in the header now).
  const windows =
    carried.kind === 'window'
      ? [phantom, ...shown.windows]
      : [...shown.windows, phantom];
  return { tabGroupId: shown.tabGroupId, windows };
}
