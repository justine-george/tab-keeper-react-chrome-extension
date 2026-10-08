import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-458. A saved window keeps Chrome's shape: pinned tabs first. Where a tab is dropped decides its pin; the row never moves.

type Pinnable = Pick<tabData, 'pinned'>;

export function pinnedRunLength(tabs: readonly Pinnable[]): number {
  const firstUnpinned = tabs.findIndex((tab) => tab.pinned !== true);
  return firstUnpinned === -1 ? tabs.length : firstUnpinned;
}

// The boundary keeps the tab's pin: it is the own slot of both the last pinned and the first unpinned tab, so a put-back changes nothing.
export function isPinnedSlot(
  others: readonly Pinnable[],
  toIndex: number,
  wasPinned: boolean
): boolean {
  const run = pinnedRunLength(others);
  if (toIndex < run) return true;
  if (toIndex > run) return false;
  return wasPinned;
}

// A band unpins (A6), as in Chrome. `delete`, never undefined: Firestore rejects undefined.
export function landTab(
  tab: tabData,
  others: readonly Pinnable[],
  toIndex: number,
  toChromeGroupId: string | undefined
): void {
  const pinned =
    toChromeGroupId === undefined &&
    isPinnedSlot(others, toIndex, tab.pinned === true);
  if (toChromeGroupId === undefined) delete tab.chromeGroupId;
  else tab.chromeGroupId = toChromeGroupId;
  if (pinned) tab.pinned = true;
  else delete tab.pinned;
}

// The group list's landingRange (RowDragArea): no ceiling, since the engine bounds it to the rows that exist.
// A window drawn with no rows offers only index 0; the reducer floor puts the group after its pinned run.
export function groupLandingRange(
  windows: readonly Pick<windowGroupData, 'windowId' | 'tabs'>[],
  drawsNoRows: (windowId: string) => boolean
): (
  rowId: string,
  windowId: string | undefined
) => { min: number; max: number } {
  return (_rowId, windowId) => {
    const target = windows.find((w) => w.windowId === windowId);
    const drawn = target !== undefined && !drawsNoRows(target.windowId);
    return {
      min: drawn ? pinnedRunLength(target.tabs) : 0,
      max: Number.MAX_SAFE_INTEGER,
    };
  };
}

// A window drawn with no rows gives position no meaning, so a drop there keeps the pin, at the start of its own run.
export function collapsedTabIndex(
  targetTabs: readonly Pick<tabData, 'tabId' | 'pinned'>[],
  tabId: string,
  heldPinned: boolean
): number {
  return heldPinned
    ? 0
    : pinnedRunLength(targetTabs.filter((tab) => tab.tabId !== tabId));
}

export function isTabPinnedIn(
  sessions: readonly tabContainerData[],
  ref: { tabGroupId: string; windowId: string; tabId: string }
): boolean {
  return (
    sessions
      .find((s) => s.tabGroupId === ref.tabGroupId)
      ?.windows.find((w) => w.windowId === ref.windowId)
      ?.tabs.find((tab) => tab.tabId === ref.tabId)?.pinned === true
  );
}

// Restore would ignore an id with no tab, but the tab coming back later must not reclaim the window.
export function forgetMissingActiveTab(
  window: Pick<windowGroupData, 'tabs' | 'activeTabId'>
): void {
  if (
    window.activeTabId !== undefined &&
    !window.tabs.some((tab) => tab.tabId === window.activeTabId)
  ) {
    delete window.activeTabId;
  }
}
