import type { Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openPage } from './fixtures/onboarding';

// KAN-718 on the real extension: Open now's search matches a live group's
// title and draws every tab in the group, as saved search does. Needs the
// tabGroups grant, so it cannot live in open-now-search.spec.ts.

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';

const field = (page: Page): Locator =>
  page
    .locator(OPEN_NOW)
    .getByRole('textbox', { name: 'Search open tabs', exact: true });

const liveRow = (page: Page, title: string): Locator =>
  page
    .locator(OPEN_NOW)
    .getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

const band = (page: Page, name: string): Locator =>
  page.locator(OPEN_NOW).getByRole('group', { name, exact: true });

const count = (page: Page, matched: number): Locator =>
  page.locator(OPEN_NOW).getByText(new RegExp(`· ${matched} of \\d+ Tabs$`));

// A window of its own, unfocused so the tab view stays in front, whose first
// two tabs Chrome groups under `groupTitle`.
async function openGroupedWindow(
  worker: Worker,
  titles: string[],
  groupTitle: string
): Promise<void> {
  await worker.evaluate(
    async ({ urls, groupTitle }) => {
      const win = await chrome.windows.create({ focused: false, url: urls });
      const ids = (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
      const id = await chrome.tabs.group({
        tabIds: [ids[0], ids[1]],
        createProperties: { windowId: win?.id },
      });
      await chrome.tabGroups.update(id, { title: groupTitle, color: 'blue' });
    },
    {
      urls: titles.map((title) => `data:text/html,<title>${title}</title>`),
      groupTitle,
    }
  );
}

test.describe('Open now search matches group titles (KAN-718)', () => {
  test("a group's title draws every tab in it, beside tabs that match on their own, and the count says so", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await openGroupedWindow(
      serviceWorker,
      ['Hotel booking', 'JR pass', 'Kyoto ramen guide', 'Docs'],
      'Kyoto trip'
    );
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    // PREMISE: the group is drawn as a band, so the grant reached the pane.
    await expect(band(page, 'Kyoto trip')).toBeVisible();
    await expect(liveRow(page, 'Docs')).toBeVisible();

    // Only the group's title holds "trip": both its tabs, nothing else.
    await field(page).fill('trip');
    await expect(liveRow(page, 'Hotel booking')).toBeVisible();
    await expect(liveRow(page, 'JR pass')).toBeVisible();
    await expect(liveRow(page, 'Kyoto ramen guide')).toHaveCount(0);
    await expect(liveRow(page, 'Docs')).toHaveCount(0);
    await expect(band(page, 'Kyoto trip')).toBeVisible();
    await expect(count(page, 2)).toBeVisible();

    // "kyoto" is the group's title and one ungrouped tab's own.
    await field(page).fill('kyoto');
    await expect(liveRow(page, 'Hotel booking')).toBeVisible();
    await expect(liveRow(page, 'JR pass')).toBeVisible();
    await expect(liveRow(page, 'Kyoto ramen guide')).toBeVisible();
    await expect(liveRow(page, 'Docs')).toHaveCount(0);
    await expect(count(page, 3)).toBeVisible();
  });
});
