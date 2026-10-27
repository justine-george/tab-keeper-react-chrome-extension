import { expect, type Page } from '@playwright/test';

import { standIn } from './standInPages';

// KAN-823. Driven as a tab, the popup page is itself the current tab -- a Tab
// Keeper page -- so it offers no Add current tab. A real popup opens over the
// user's page: make an ordinary page current in this page's window, then open
// this page again, still in the background, so it asks afresh.
export async function overAnOrdinaryTab(
  page: Page,
  title = 'Current tab'
): Promise<string> {
  const url = standIn(title);
  await page.evaluate(
    async ({ address, name }) => {
      const self = await chrome.tabs.getCurrent();
      const made = await chrome.tabs.create({
        windowId: self?.windowId,
        url: address,
        active: true,
      });
      const id = made.id;
      if (id === undefined) throw new Error('the tab was made without an id');
      for (;;) {
        const now = await chrome.tabs.get(id);
        if (now.status === 'complete' && now.title === name) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    { address: url, name: title }
  );
  await page.reload();
  // CONTROL: what the Add handler's own query now answers.
  expect(await currentTabUrl(page)).toBe(url);
  return url;
}

// What the Add handler's own query answers, asked from an extension page.
export const currentTabUrl = (page: Page): Promise<string | undefined> =>
  page.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
        ?.url
  );
