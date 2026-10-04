import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import { saveRowMenu } from './fixtures/menus';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-208. Real browser: the claim rests on windows.getAll and tabs.getCurrent
// behaving in an extension PAGE, which jsdom cannot vouch for.
// The harness's popup is itself a tab, so it doubles as the control: every
// Tab Keeper page (index.html, export.html) is left out by address (KAN-300).

const SAVED = buildSession({
  tabGroupId: 's0',
  title: 'Already saved',
  isSelected: true,
});

/** No spaces in the title: a data: URL keeps them only when encoded. */
const titled = (title: string) =>
  `data:text/html,<title>${title}</title><p>${title}</p>`;

/** Waits for the title: a capture taken earlier lists the address instead. */
async function openTab(
  worker: Worker,
  title: string,
  windowId?: number
): Promise<number> {
  return worker.evaluate(
    async ({ url, title, windowId }) => {
      const tab = await chrome.tabs.create({
        url,
        active: false,
        ...(windowId === undefined ? {} : { windowId }),
      });
      for (let i = 0; i < 100; i++) {
        const now = await chrome.tabs.get(tab.id!);
        if (now.status === 'complete' && now.title === title) return now.id!;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`tab never reported the title ${title}`);
    },
    { url: titled(title), title, windowId }
  );
}

/** A second real window, holding one titled tab. Returns the window id. */
async function openWindow(worker: Worker, title: string): Promise<number> {
  return worker.evaluate(
    async ({ url, title }) => {
      const win = await chrome.windows.create({ url, focused: false });
      // A window that was not created is a broken fixture, not a missing tab.
      const windowId = win?.id;
      const tabId = win?.tabs?.[0]?.id;
      if (windowId === undefined || tabId === undefined) {
        throw new Error('windows.create returned no window with a tab');
      }
      for (let i = 0; i < 100; i++) {
        const now = await chrome.tabs.get(tabId);
        if (now.status === 'complete' && now.title === title) return windowId;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`window tab never reported the title ${title}`);
    },
    { url: titled(title), title }
  );
}

async function openPopup(
  context: BrowserContext,
  extensionId: string,
  lang = 'en'
): Promise<{ popup: Page; strings: Record<string, string> }> {
  await seedSessions(context, {
    ...buildContainer([SAVED]),
    selectedTabGroupId: 's0',
  });
  // i18n reads `language` at module load, so it must be seeded before render.
  await seedSettings(context, { language: lang });
  const strings = localeStrings(lang);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 790, height: 550 });
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(saveRowMenu(popup)).toBeVisible();
  return { popup, strings };
}

const openTabCount = (worker: Worker) =>
  worker.evaluate(() => chrome.tabs.query({}).then((tabs) => tabs.length));

/** By URL prefix, not `isTabKeeperPage`, so it counts independently. */
const tabKeeperTabCount = (worker: Worker, extensionId: string) =>
  worker.evaluate(
    (prefix) =>
      chrome.tabs
        .query({})
        .then(
          (tabs) =>
            tabs.filter((tab) => (tab.url ?? '').startsWith(prefix)).length
        ),
    `chrome-extension://${extensionId}/`
  );

/**
 * Seeded by a direct localStorage write, not `seedSessions`: its init script
 * re-runs in the export page's preview iframe and erases anything the app
 * saved, so a "saves nothing" check would pass against a page that saved.
 */
async function popupSeededByWrite(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.evaluate(
    (container) => {
      localStorage.setItem('tabContainerData', container);
    },
    JSON.stringify({ ...buildContainer([SAVED]), selectedTabGroupId: 's0' })
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Already saved', exact: true })
  ).toBeVisible();
  return page;
}

test.describe('export open windows (KAN-208)', () => {
  test('the menu item previews every open tab except every Tab Keeper page, and saves nothing', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const strings = localeStrings('en');
    const popup = await popupSeededByWrite(context, extensionId);

    await openTab(serviceWorker, 'Alpha-one');
    const second = await openWindow(serviceWorker, 'Beta-one');
    await openTab(serviceWorker, 'Beta-two', second);
    // PREMISE: two normal windows, or "2 Windows" below proves nothing.
    expect(
      await serviceWorker.evaluate(() =>
        chrome.windows.getAll({ windowTypes: ['normal'] }).then((w) => w.length)
      )
    ).toBe(2);

    await saveRowMenu(popup).click();
    const [exportPage] = await Promise.all([
      context.waitForEvent('page'),
      popup
        .getByRole('menuitem', { name: strings['Export open windows'] })
        .click(),
    ]);
    await exportPage.waitForLoadState();
    expect(exportPage.url()).toContain('export.html?source=open-windows');

    const preview = exportPage.frameLocator('iframe');
    // Once each: a window's heading is no longer its first tab's title (L4).
    for (const title of ['Alpha-one', 'Beta-one', 'Beta-two']) {
      await expect(preview.getByText(title, { exact: true })).toBeVisible();
    }

    // chrome-extension:// is not a web link, so a leaked page shows as text.
    await expect(preview.getByText(/\/index\.html$/)).toHaveCount(0);
    await expect(preview.getByText(/export\.html/)).toHaveCount(0);

    // PREMISE: the popup and the export page are the only Tab Keeper tabs.
    const excluded = await tabKeeperTabCount(serviceWorker, extensionId);
    expect(excluded).toBe(2);

    const open = await openTabCount(serviceWorker);
    await expect(
      exportPage.getByText(`2 Windows · ${open - excluded} Tabs`)
    ).toBeVisible();

    await expect(
      exportPage.getByText(strings['Open windows'], { exact: true })
    ).toBeVisible();
    const stored = await exportPage.evaluate(() =>
      (
        JSON.parse(localStorage.getItem('tabContainerData')!) as {
          tabGroups: { title: string }[];
        }
      ).tabGroups.map((g) => g.title)
    );
    expect(stored).toEqual(['Already saved']);
    // `exact`: the rename control's name contains "Already saved" too.
    await expect(
      popup.getByRole('button', { name: 'Already saved', exact: true })
    ).toBeVisible();
    // `exact`: "Open windows" is a substring of the save-all button's name.
    await expect(
      popup.getByRole('button', { name: strings['Open windows'], exact: true })
    ).toHaveCount(0);
  });

  test('a reload captures again, so a tab opened since appears', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await openTab(serviceWorker, 'Alpha-one');
    const exportPage = await context.newPage();
    await exportPage.goto(
      `chrome-extension://${extensionId}/export.html?source=open-windows`
    );
    const preview = exportPage.frameLocator('iframe');
    await expect(
      preview.getByText('Alpha-one', { exact: true }).first()
    ).toBeVisible();
    // CONTROL: absent before -- the capture is taken once, at load.
    await expect(preview.getByText('Gamma-late', { exact: true })).toHaveCount(
      0
    );

    await openTab(serviceWorker, 'Gamma-late');
    await expect(preview.getByText('Gamma-late', { exact: true })).toHaveCount(
      0
    );

    await exportPage.reload();
    await exportPage.waitForLoadState();
    await expect(
      exportPage
        .frameLocator('iframe')
        .getByText('Gamma-late', { exact: true })
        .first()
    ).toBeVisible();
  });

  // Navigates the context's initial about:blank, so nothing else is open.
  test('with nothing open but itself, the page says not found', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const only = context.pages()[0] ?? (await context.newPage());
    // PREMISE: one tab in the whole browser.
    expect(await openTabCount(serviceWorker)).toBe(1);

    await only.goto(
      `chrome-extension://${extensionId}/export.html?source=open-windows`
    );

    await expect(only.getByText('Session not found')).toBeVisible();
    await expect(only.locator('iframe')).toHaveCount(0);
  });

  // 115px is the line searchRowAlignment.spec pins to the session card.
  // German too: a wrapped label would move the row.
  for (const lang of ['en', 'de']) {
    test(`the save row is 58px tall and its two segments match (${lang})`, async ({
      context,
      extensionId,
    }) => {
      const { popup, strings } = await openPopup(context, extensionId, lang);

      const geometry = await popup.evaluate((saveAll) => {
        // Scoped to the row: several controls carry "More actions".
        const row = document.querySelector('div:has(> input#name)')!;
        const input = row.querySelector('input#name')!.getBoundingClientRect();
        return {
          inputBottom: input.bottom,
          saveAll: row
            .querySelector(`[aria-label="${saveAll}"]`)!
            .getBoundingClientRect(),
          trigger: row
            .querySelector('[aria-haspopup="menu"]')!
            .getBoundingClientRect(),
        };
      }, strings['Save every open window as a session']);

      expect(geometry.inputBottom).toBeCloseTo(115, 0);
      expect(geometry.trigger.height).toBeCloseTo(geometry.saveAll.height, 0);
      expect(geometry.trigger.width).toBeCloseTo(28, 0);
      expect(geometry.trigger.bottom).toBeCloseTo(geometry.saveAll.bottom, 0);
      expect(geometry.trigger.left).toBeCloseTo(geometry.saveAll.right, 0);
    });
  }

  // Longest locales. A long label pushes the menu past the popup's left edge,
  // where it is clipped and unclickable.
  for (const lang of ['en', 'fr', 'de', 'ru']) {
    test(`the menu fits inside the popup and is hittable over the list (${lang})`, async ({
      context,
      extensionId,
    }) => {
      const { popup, strings } = await openPopup(context, extensionId, lang);

      await saveRowMenu(popup).click();
      const menu = popup.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveCount(2);
      // Not toHaveText: it would include the aria-hidden glyph's ligature.
      await expect(menu.getByRole('menuitem').nth(0)).toHaveAccessibleName(
        strings['Save current window as a session']
      );
      await expect(menu.getByRole('menuitem').nth(1)).toHaveAccessibleName(
        strings['Export open windows']
      );

      const box = await popup.evaluate(() => {
        const el = document.querySelector('[role="menu"]')!;
        const r = el.getBoundingClientRect();
        // Hangs from the group's content box, one border inside the row edge.
        const rowBottom = document
          .querySelector('input#name')!
          .getBoundingClientRect().bottom;
        const items = Array.from(el.querySelectorAll('[role="menuitem"]'));

        // A Range reports one rect per line box. Range the label text only: the
        // glyph span sits 2px off vertically and reads [2, 2] when unwrapped.
        const labelLines = (item: Element): number => {
          const text = Array.from(item.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE
          );
          if (!text) return 0;
          const range = document.createRange();
          range.selectNodeContents(text);
          return new Set(
            Array.from(range.getClientRects()).map((rect) =>
              Math.round(rect.top)
            )
          ).size;
        };

        const lines = items.map(labelLines);

        // CONTROL: a copy forced to wrap must measure more than one line.
        const clone = items[0].cloneNode(true) as HTMLElement;
        clone.style.whiteSpace = 'normal';
        clone.style.width = '40px';
        el.appendChild(clone);
        const wrapsWhenForced = labelLines(clone) > 1;
        clone.remove();
        const second = items[1].getBoundingClientRect();
        const hit = document.elementFromPoint(
          second.left + second.width / 2,
          second.top + second.height / 2
        );
        return {
          left: r.left,
          right: r.right,
          topBelowRow: rowBottom - r.top,
          overflow: el.scrollWidth - el.clientWidth,
          lines,
          wrapsWhenForced,
          itemHeights: items.map((item) =>
            Math.round(item.getBoundingClientRect().height)
          ),
          hitInsideSecondItem: items[1].contains(hit),
        };
      });

      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(790);
      expect(box.topBelowRow).toBeGreaterThanOrEqual(0);
      expect(box.topBelowRow).toBeLessThanOrEqual(1);
      expect(box.overflow).toBe(0);
      // CONTROL: the metric can report a wrap.
      expect(box.wrapsWhenForced).toBe(true);
      expect(box.lines).toEqual([1, 1]);
      // A wrapped item would be taller; nothing fixes its height.
      expect(box.itemHeights).toEqual([34, 34]);
      expect(box.hitInsideSecondItem).toBe(true);
    });
  }
});
