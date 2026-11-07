// KAN-893. Whether a tab a drop opened still shows its own page, so undo
// closes it: its placeholder, the address it was opened with, or the one its
// first load settled on (a redirect). Page-side and outside Redux, like
// newWindowFollow: a live tab id is never stored.
import { isLazyPlaceholder, resolveTabUrl } from './local';
import type { OpenedTab } from './openedCopy';

// Watched tab → its first settled address; null while it hasn't settled.
const settled = new Map<number, string | null>();
let listening = false;

function onUpdated(
  tabId: number,
  change: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab
): void {
  if (change.status !== 'complete' || settled.get(tabId) !== null) return;
  const url = tab.url ?? '';
  if (url === '' || isLazyPlaceholder(url)) return;
  settled.set(tabId, url);
}

function onRemoved(tabId: number): void {
  settled.delete(tabId);
}

export function watchSettling(tabIds: readonly number[]): void {
  for (const id of tabIds) if (!settled.has(id)) settled.set(id, null);
  if (listening) return;
  listening = true;
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
}

export function forgetSettled(tabIds: readonly number[]): void {
  for (const id of tabIds) settled.delete(id);
  if (settled.size > 0 || !listening) return;
  listening = false;
  chrome.tabs.onUpdated.removeListener(onUpdated);
  chrome.tabs.onRemoved.removeListener(onRemoved);
}

// As Chrome writes it ("https://a.test" shows as "https://a.test/"); unparsable stays as is.
function normal(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

// Where it is going, while it loads; else where it is.
export function showsItsPage(tab: chrome.tabs.Tab, opened: OpenedTab): boolean {
  const url = tab.pendingUrl || tab.url || '';
  if (isLazyPlaceholder(url)) return true;
  const now = normal(url);
  const own = [
    opened.openedUrl,
    resolveTabUrl(opened.saved.url),
    tab.id === undefined ? null : settled.get(tab.id),
  ];
  return own.some((address) => address != null && normal(address) === now);
}
