// KAN-815. A saved tab or group carried over Currently open, as Open now's
// drag lists adopt it: a phantom resting in a trailing "New window" block
// after the last window, as the saved pane's carried item rests in its own
// (TabGroupDetailsContainer, NEW_LAST_WINDOW). Adopting it moves nothing; a
// release in a live window opens a copy there, in the block a new window.
import { pickOf, sourceWindowOf } from '../../../redux/carriedItem';
import type { CarriedItem } from '../../../redux/carriedItem';
import type { tabContainerData } from '../../../redux/slices/tabContainerDataStateSlice';
import { phantomIdOf } from '../../../utils/functions/carriedView';
import { groupItemIdOf } from '../../../utils/functions/tabGroups';
import type { DragWindows } from '../rightpane/rowDrag/dropRules';

// The trailing block's window id, in both of Open now's lists.
export const OPEN_NOW_NEW_WINDOW = 'open-now:new-window';
// The header's, where an adopted carry lands as a new window too (adoptedHeaderLanding).
export const OPEN_NOW_HEADER_NEW_WINDOW = 'open-now:new-window:header';
export {
  OPEN_NOW_FIRST_TARGET,
  OPEN_NOW_LAST_TARGET,
} from '../rightpane/newWindowTarget';

// The saved pane draws its own phantom of the same item at the same time
// (carriedRowId), so Open now's go by ids of their own.
const openNowPhantomIdOf = (id: string) => `open-now:${phantomIdOf(id)}`;

export interface CarriedIntoOpenNow {
  kind: 'tab' | 'group';
  // The phantom's row id, in the list that drags its kind.
  rowId: string;
  // The trailing block, holding the phantom tab or group under phantom ids.
  window: DragWindows[number];
  // The saved window's kind: it lands only in a live window of the same.
  incognito: boolean;
  // The tab's saved pin; false for a group.
  pinned: boolean;
}

/**
 * Null when nothing Open now can open is carried: no carry, a live item (it
 * is already open), a window (taken by the pane, never adopted), an item the
 * store no longer holds, or a group without the grant (its band isn't drawn
 * anywhere, so it can't be picked up).
 */
export function carriedIntoOpenNow(
  tabGroups: readonly tabContainerData[],
  item: CarriedItem | null,
  hasTabGroups: boolean
): CarriedIntoOpenNow | null {
  if (item === null || item.source !== 'saved') return null;
  const from = sourceWindowOf(tabGroups, item);
  if (from === null) return null;
  const pick = pickOf(item);
  const incognito = from.incognito === true;

  if (pick.kind === 'tab') {
    const tab = from.tabs.find((t) => t.tabId === pick.tabId);
    if (tab === undefined) return null;
    const rowId = openNowPhantomIdOf(tab.tabId);
    return {
      kind: 'tab',
      rowId,
      window: {
        windowId: OPEN_NOW_NEW_WINDOW,
        // Loose and unpinned in the block: a new window's own run is empty.
        tabs: [{ tabId: rowId, pinned: false }],
        chromeTabGroups: [],
      },
      incognito,
      pinned: tab.pinned === true,
    };
  }
  if (pick.kind === 'group' && hasTabGroups) {
    const group = from.chromeTabGroups?.find((g) => g.groupId === pick.groupId);
    const tabs = from.tabs.filter((t) => t.chromeGroupId === pick.groupId);
    if (group === undefined || tabs.length === 0) return null;
    const groupId = openNowPhantomIdOf(group.groupId);
    return {
      kind: 'group',
      rowId: groupItemIdOf(groupId),
      window: {
        windowId: OPEN_NOW_NEW_WINDOW,
        tabs: tabs.map((t) => ({
          tabId: openNowPhantomIdOf(t.tabId),
          pinned: false,
          chromeGroupId: groupId,
        })),
        chromeTabGroups: [{ groupId, title: group.title, color: group.color }],
      },
      incognito,
      pinned: false,
    };
  }
  return null;
}
