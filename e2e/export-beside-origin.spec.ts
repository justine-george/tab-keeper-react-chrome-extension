import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { saveRowMenu, sessionHeaderMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-527. The export page opens right after the tab it was opened from, as
// its child, so closing it lands back there. Which tab Chrome activates on a
// close is Chromium's tab strip, which the unit fake does not model.
// The harness's popup is itself a tab: the origin here is that tab, which is
// also the full view's case.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  isSelected: true,
});

type Placed = {
  id: number;
  index: number;
  windowId: number;
  openerTabId: number | undefined;
  active: boolean;
};

/** The tab whose address starts with `prefix`; exactly one must exist. */
const tabAt = (worker: Worker, prefix: string): Promise<Placed> =>
  worker.evaluate(async (prefix) => {
    const found = (await chrome.tabs.query({})).filter((tab) =>
      (tab.url ?? '').startsWith(prefix)
    );
    if (found.length !== 1 || found[0].id === undefined) {
      throw new Error(`${found.length} tabs at ${prefix}`);
    }
    const [{ id, index, windowId, openerTabId, active }] = found;
    return { id, index, windowId, openerTabId, active };
  }, prefix);

/** Two plain tabs after the popup, so "the end" and "beside it" differ. */
async function addTabsAfter(
  context: BrowserContext,
  worker: Worker,
  windowId: number
): Promise<void> {
  const pages = context.pages().length;
  await worker.evaluate(async (windowId) => {
    for (const title of ['After-one', 'After-two']) {
      await chrome.tabs.create({
        url: `data:text/html,<title>${title}</title>`,
        windowId,
        active: false,
      });
    }
  }, windowId);
  // Until both are pages: a late one is the next 'page' event (KAN-560).
  await expect.poll(() => context.pages().length).toBe(pages + 2);
}

async function openPopup(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-kyoto',
  });
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 790, height: 550 });
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(saveRowMenu(popup)).toBeVisible();
  return popup;
}

const ENTRY_POINTS: {
  name: string;
  choose: (popup: Page) => Promise<void>;
  page: string;
}[] = [
  {
    name: 'Save open windows as PDF…',
    choose: async (popup) => {
      await saveRowMenu(popup).click();
      await item(popup, 'Save open windows as PDF…').click();
    },
    page: 'export.html?source=open-windows',
  },
  {
    name: 'Save as PDF… (session menu)',
    choose: async (popup) => {
      await sessionHeaderMenu(popup).click();
      await item(popup, 'Save as PDF…').click();
    },
    page: 'export.html?session=session-kyoto',
  },
];

const item = (popup: Page, name: string): Locator =>
  popup.getByRole('menuitem', { name, exact: true });

test.describe('the export page opens beside its tab (KAN-527)', () => {
  for (const entry of ENTRY_POINTS) {
    test(`${entry.name}: opens right after the tab, and closing it lands back there`, async ({
      context,
      serviceWorker,
      extensionId,
    }) => {
      const popup = await openPopup(context, extensionId);
      const origin = await tabAt(
        serviceWorker,
        `chrome-extension://${extensionId}/index.html`
      );
      await addTabsAfter(context, serviceWorker, origin.windowId);

      // PREMISE: the popup is its window's active tab, with two tabs after it.
      const before = await serviceWorker.evaluate(
        (windowId) => chrome.tabs.query({ windowId }),
        origin.windowId
      );
      expect(before.find((tab) => tab.active)?.id).toBe(origin.id);
      expect(before.length - 1 - origin.index).toBe(2);

      const [exportPage] = await Promise.all([
        context.waitForEvent('page'),
        entry.choose(popup),
      ]);
      await exportPage.waitForLoadState();
      // PREMISE: the page event caught is the export page's.
      expect(exportPage.url()).toBe(
        `chrome-extension://${extensionId}/${entry.page}`
      );

      const opened = await tabAt(
        serviceWorker,
        `chrome-extension://${extensionId}/${entry.page}`
      );
      expect(opened.windowId).toBe(origin.windowId);
      expect(opened.index).toBe(origin.index + 1);
      expect(opened.openerTabId).toBe(origin.id);
      expect(opened.active).toBe(true);

      // Closed the way ⌘W closes it: through the tab strip, not the page.
      await serviceWorker.evaluate((id) => chrome.tabs.remove(id), opened.id);
      await expect
        .poll(() =>
          serviceWorker.evaluate(
            (windowId) =>
              chrome.tabs
                .query({ windowId, active: true })
                .then(([tab]) => tab?.id),
            origin.windowId
          )
        )
        .toBe(origin.id);
    });
  }
});
