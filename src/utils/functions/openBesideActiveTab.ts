/**
 * Opens `url` right after the current window's active tab, as its child, so
 * closing it returns there (KAN-527). From the popup that is the tab behind
 * it; from the full view, the full view itself. Chromium needs both the index
 * and the opener: measured, the index alone lands on the next tab and the
 * opener alone opens at the end.
 *
 * Opens it as Chrome would by default, at the end of the window, when there
 * is no active tab to read or it is incognito: a Tab Keeper page cannot live
 * in an incognito window, so Chrome moves it to a normal one (KAN-460 Part 3).
 *
 * Resolves once the tab is created. A caller in the popup gets nothing after
 * that: the new tab takes focus and destroys the popup.
 */
export async function openBesideActiveTab(url: string): Promise<void> {
  const [active] = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .catch(() => []);
  if (active?.id === undefined || active.incognito) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.create({
    url,
    index: active.index + 1,
    openerTabId: active.id,
    windowId: active.windowId,
  });
}
