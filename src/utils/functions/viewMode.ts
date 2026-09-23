// KAN-279 (Part D). Whether this page is the extension's own tab (opened by
// openOrFocusTabView, later tasks) or the popup, and the pure helpers those
// later tasks build on -- kept dependency-free so they can be imported from
// anywhere, including src/background.ts, without dragging in a redux slice.
// Importing is safe; CALLING isTabView()/ownTabId() is not -- both read
// `window`/`chrome.tabs.getCurrent()`, neither of which exists in the
// worker, so the worker must never invoke them.

/**
 * `'tab'` only for a search string carrying exactly `view=tab`. Any other
 * value -- a different case, a different word, or the param missing
 * entirely -- means popup (D3). `URLSearchParams` does the parsing, so a
 * leading `?` is optional and `?x=1&view=tab` still reads `tab`; only the
 * VALUE of `view` decides, never which other params are present.
 */
export function parseViewMode(search: string): 'tab' | 'popup' {
  return new URLSearchParams(search).get('view') === 'tab' ? 'tab' : 'popup';
}

/**
 * Whether this page is the tab view. Reads `window.location.search` on
 * every call rather than once at module load: the URL never actually
 * changes within a page's life, so the two are equivalent in production,
 * but a per-call read is what lets a jsdom test move the URL with
 * `history.replaceState` and see the answer follow, without reimporting
 * the module.
 */
export function isTabView(): boolean {
  return parseViewMode(window.location.search) === 'tab';
}

/**
 * This page's own tab id, or undefined outside the tab view. The popup and
 * the service worker are never a tab Chrome will hand an id back for --
 * `chrome.tabs.getCurrent()` already answers undefined from either -- but
 * the view check is asked first anyway, so this never has a reason to touch
 * the `tabs` API at all outside the one place that needs to.
 */
export async function ownTabId(): Promise<number | undefined> {
  if (!isTabView()) return undefined;
  const tab = await chrome.tabs.getCurrent();
  return tab?.id;
}

/**
 * The tab most recently used in this window, other than this page itself
 * (D15) -- the source for the tab view's "New tab" name suggestion.
 * `lastAccessed` is undefined for a tab Chrome has not stamped yet; that
 * counts as 0 rather than disqualifying the tab, so an unstamped tab still
 * beats nothing, and a tie -- including every tab being unstamped -- keeps
 * whichever came first in `tabs`, the order `tabs.query` returns them in.
 */
export function pickNameSourceTab(
  tabs: chrome.tabs.Tab[],
  ownId: number | undefined
): chrome.tabs.Tab | undefined {
  let picked: chrome.tabs.Tab | undefined;
  let pickedAccessed = -1;
  for (const tab of tabs) {
    if (tab.id === ownId) continue;
    const accessed = tab.lastAccessed ?? 0;
    if (accessed > pickedAccessed) {
      picked = tab;
      pickedAccessed = accessed;
    }
  }
  return picked;
}
