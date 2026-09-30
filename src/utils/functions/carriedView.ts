// KAN-350. What the saved detail draws while something is carried.
import type {
  CarriedRef,
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { partitionTabsIntoRuns } from './tabGroups';

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
