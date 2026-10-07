// Tab Keeper's own pinnable tab: the full view, or the stub that stands in for it until shown.
// Worker-safe: chrome types only, nothing from redux or window.

export const TAB_VIEW_PATH = 'index.html?view=tab';
export const STUB_PATH = 'pinned.html';

type Addressed = Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>;

// `||`, not `??`: an uncommitted url is '' rather than undefined.
const addressOf = (tab: Addressed): string => tab.url || tab.pendingUrl || '';

export const isStub = (tab: Addressed): boolean =>
  addressOf(tab).startsWith(chrome.runtime.getURL(STUB_PATH));

export const isTabKeeperTab = (tab: Addressed): boolean =>
  isStub(tab) ||
  addressOf(tab).startsWith(chrome.runtime.getURL(TAB_VIEW_PATH));

type TabWithId = chrome.tabs.Tab & { id: number };

// The pinned Tab Keeper tab a Switch carries: the last-focused window's, else the first found's; a loaded full view over a stub.
export function findCarriedTab(
  windows: chrome.windows.Window[],
  lastFocusedId: number | undefined
): TabWithId | null {
  const pinned = windows
    .flatMap((win) => win.tabs ?? [])
    .filter(
      (tab): tab is TabWithId =>
        tab.pinned && tab.id !== undefined && isTabKeeperTab(tab)
    );
  const chosen = (
    pinned.find((tab) => tab.windowId === lastFocusedId) ?? pinned[0]
  )?.windowId;
  const inChosen = pinned.filter((tab) => tab.windowId === chosen);
  return inChosen.find((tab) => !isStub(tab)) ?? inChosen[0] ?? null;
}

// Never rejects: a missing stub costs the window its pinned tab, never the restore.
export async function addPinnedStub(windowId: number): Promise<void> {
  try {
    await chrome.tabs.create({
      windowId,
      url: chrome.runtime.getURL(STUB_PATH),
      index: 0,
      pinned: true,
      active: false,
    });
  } catch (error) {
    console.warn('Could not add the pinned Tab Keeper tab:', error);
  }
}

// For a window that came back with whatever it had: a stub only if it has no pinned Tab Keeper tab.
export async function ensurePinnedStub(windowId: number): Promise<void> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch (error) {
    console.warn('Could not read the reopened window:', error);
    return;
  }
  if (tabs.some((tab) => tab.pinned && isTabKeeperTab(tab))) return;
  await addPinnedStub(windowId);
}

// True once the tab is in the window. A cross-window move arrives unpinned, so it is pinned again.
export async function carryPinnedTab(
  tabId: number,
  windowId: number
): Promise<boolean> {
  try {
    await chrome.tabs.move(tabId, { windowId, index: 0 });
  } catch (error) {
    console.warn('Could not carry the pinned Tab Keeper tab:', error);
    return false;
  }
  try {
    await chrome.tabs.update(tabId, { pinned: true });
  } catch (error) {
    console.warn('Could not pin the carried Tab Keeper tab:', error);
  }
  return true;
}
