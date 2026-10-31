import { resolveTabUrl } from './local';
import { switchToOpenTab, thisWindowFirst, toOpenWindows } from './openNow';
import type { OpenTab, OpenWindow } from './openNow';

// KAN-884. The open tab a saved tab's click switches to: the same address,
// compared exactly once lazy-load and suspended wrappers are unwrapped on both
// sides (Remove duplicates' rule). Tab Keeper's own window first, then the
// one used last; without lastAccessed, Currently open's order. A saved tab
// with no address has no copy. Tab Keeper pages are never listed, so never a copy.
export function findOpenCopy(
  url: string,
  windows: readonly OpenWindow[]
): OpenTab | undefined {
  const address = resolveTabUrl(url);
  if (address === '') return undefined;
  // The own window is read first, so a copy there is never displaced by one elsewhere.
  let best: { tab: OpenTab; own: boolean } | undefined;
  for (const window of thisWindowFirst(windows)) {
    for (const tab of window.tabs) {
      if (resolveTabUrl(tab.url) !== address) continue;
      const own = window.isThisWindow;
      if (
        best === undefined ||
        (own === best.own &&
          (tab.lastAccessed ?? -Infinity) >
            (best.tab.lastAccessed ?? -Infinity))
      )
        best = { tab, own };
    }
  }
  return best?.tab;
}

// KAN-884. Middle-click, ⌘-click on a Mac or Ctrl-click elsewhere: a new copy
// in the background. A Mac's Ctrl-click is its context menu (KAN-708).
export function opensInBackground(
  e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey'>,
  isMac: boolean
): boolean {
  return e.button === 1 || (isMac ? e.metaKey : e.ctrlKey);
}

// KAN-884. Switches to an open copy of `url` and focuses its window. False
// when none is open, the windows cannot be read, or the copy closed before
// the switch: the caller then opens a new one.
export async function switchToOpenCopy(url: string): Promise<boolean> {
  try {
    const [all, self] = await Promise.all([
      chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      // The window Tab Keeper is in: the tab view's own, or the one behind the popup.
      chrome.windows.getCurrent().catch(() => undefined),
    ]);
    const copy = findOpenCopy(url, toOpenWindows(all, null, self?.id ?? null));
    if (copy === undefined) return false;
    await switchToOpenTab(copy);
    return true;
  } catch {
    return false;
  }
}
