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

// KAN-208. Exporting what is open right now, without saving it first -- in a
// real browser, because the whole claim rests on two chrome APIs behaving in
// an extension PAGE rather than in the popup: windows.getAll listing every
// window, and tabs.getCurrent naming the page's own tab. The jsdom suite holds
// the wiring; only this can say Chrome agrees.
//
// The harness drives the popup as a TAB, so the popup is itself one of the
// open tabs. That is not a nuisance here, it is the control: every Tab Keeper
// page is left out of the capture, by address (KAN-300) -- the popup
// (index.html) and the export page (export.html) alike -- so both must be
// absent from the preview, not just the one that took it.

const SAVED = buildSession({
  tabGroupId: 's0',
  title: 'Already saved',
  isSelected: true,
});

/**
 * A page whose <title> Chrome reports once it has loaded. No spaces in the
 * title: a data: URL keeps them only when encoded, and a bare word is easier
 * to read back.
 */
const titled = (title: string) =>
  `data:text/html,<title>${title}</title><p>${title}</p>`;

/**
 * Opens a tab and waits until Chrome reports its title -- a capture taken
 * before that would list the address instead, and the assertion would fail
 * for a reason that has nothing to do with the feature.
 */
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
      // Chrome types the result as possibly undefined, and a window that was
      // not created is a broken FIXTURE -- say so here rather than letting the
      // assertion that follows report it as a missing tab.
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
  // i18n reads `language` out of settingsData at MODULE LOAD, so this has to
  // be seeded before the first render -- which seedSettings does via
  // addInitScript.
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

/**
 * How many open tabs are a Tab Keeper address -- checked by URL PREFIX, not
 * by re-running `isTabKeeperPage`, so this counts independently of the
 * production predicate rather than restating it.
 */
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
 * The popup, seeded by WRITING localStorage rather than through
 * `seedSessions`.
 *
 * Load-bearing for the "nothing is saved" test, and measured: `seedSessions`
 * installs an `addInitScript`, and Playwright re-runs init scripts on every
 * navigation IN EVERY FRAME -- including the preview iframe the export page
 * mounts once its capture lands. So a session the page really did save was
 * overwritten by the seed within 100ms, and an assertion that storage still
 * held only the seeded session passed no matter what the page did.
 *
 * Proven with a deliberately-saving build: polling every 100ms, init-script
 * seeding showed ["Already saved"] throughout, while this helper showed
 * ["Already saved", "Open windows"].
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
    // `.first()`: a window's heading is its first tab's title, so "Beta-one"
    // appears twice in the file -- as the heading and as the tab.
    for (const title of ['Alpha-one', 'Beta-one', 'Beta-two']) {
      await expect(
        preview.getByText(title, { exact: true }).first()
      ).toBeVisible();
    }

    // Every Tab Keeper page is left out, by address: neither the popup
    // (index.html) nor the export page itself (export.html) is listed.
    // chrome-extension:// is not a web link, so the file shows the whole
    // address as text in either layout -- either one, left in, would match.
    await expect(preview.getByText(/\/index\.html$/)).toHaveCount(0);
    await expect(preview.getByText(/export\.html/)).toHaveCount(0);

    // PREMISE: the popup and the export page are the only two Tab Keeper
    // addresses open right now -- exactly what the count below subtracts.
    const excluded = await tabKeeperTabCount(serviceWorker, extensionId);
    expect(excluded).toBe(2);

    // The count says the same thing: every open tab but the excluded ones.
    const open = await openTabCount(serviceWorker);
    await expect(
      exportPage.getByText(`2 Windows · ${open - excluded} Tabs`)
    ).toBeVisible();

    // Named, and NOT saved: storage still holds the one seeded session, and
    // the popup's list did not grow.
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
    // `exact`: the row's rename control is named "Rename session: Already
    // saved", so a substring match resolves to two elements and Playwright
    // refuses it under strict mode.
    await expect(
      popup.getByRole('button', { name: 'Already saved', exact: true })
    ).toBeVisible();
    // `exact` again, for the opposite reason: "Open windows" is a SUBSTRING of
    // the save-all button's own name ("Save all open windows as a session"),
    // so a loose match finds that button and reports a session that does not
    // exist.
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

  // The edge: the page is the only tab open. The persistent context starts
  // with one about:blank page; navigating THAT page leaves nothing else.
  test('with nothing open but itself, the page says not found', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const only = context.pages()[0] ?? (await context.newPage());
    // PREMISE, before navigating: one tab in the whole browser.
    expect(await openTabCount(serviceWorker)).toBe(1);

    await only.goto(
      `chrome-extension://${extensionId}/export.html?source=open-windows`
    );

    await expect(only.getByText('Session not found')).toBeVisible();
    await expect(only.locator('iframe')).toHaveCount(0);
  });

  // The row is measured, not eyeballed. Its bottom edge sits on the 115px line
  // that searchRowAlignment.spec pins to the session card; the trigger is a
  // segment of the group, as tall as the button beside it. In German too,
  // because a label that wrapped somewhere would move the row.
  for (const lang of ['en', 'de']) {
    test(`the save row is 58px tall and its two segments match (${lang})`, async ({
      context,
      extensionId,
    }) => {
      const { popup, strings } = await openPopup(context, extensionId, lang);

      const geometry = await popup.evaluate((saveAll) => {
        // Scoped to the row. Two controls carry "More actions" once a session
        // is selected, and querySelector would take whichever comes first in
        // the document -- a measurement that happens to be right today and
        // would silently start describing the other pane.
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

  // The menu opens under the row, over the session list, and fits inside the
  // popup in the four longest locales. `white-space: nowrap` means a label can
  // never wrap -- what it CAN do is push the menu past the popup's left edge,
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
      // Accessible names: each item's aria-hidden glyph span carries the
      // ligature text, which toHaveText would include.
      await expect(menu.getByRole('menuitem').nth(0)).toHaveAccessibleName(
        strings['Save current window as a session']
      );
      await expect(menu.getByRole('menuitem').nth(1)).toHaveAccessibleName(
        strings['Export open windows']
      );

      const box = await popup.evaluate(() => {
        const el = document.querySelector('[role="menu"]')!;
        const r = el.getBoundingClientRect();
        // The menu hangs from the bottom of its wrapper, which is the group's
        // CONTENT box -- one border inside the row's 115px edge.
        const rowBottom = document
          .querySelector('input#name')!
          .getBoundingClientRect().bottom;
        const items = Array.from(el.querySelectorAll('[role="menuitem"]'));

        // A Range reports one rect per LINE BOX, which is the only thing that
        // moves when a label wraps -- the item's own rect covers both lines.
        //
        // The range must cover the LABEL TEXT NODE alone, not the item: an
        // item also holds an aria-hidden glyph span whose box and inline
        // content sit 2px apart vertically from line-height, so ranging over
        // the item reports three rects on two `top` values for a label that
        // has not wrapped at all. Measured -- that read as [2, 2] against
        // correct code.
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

        // CONTROL, in the page: the same measurement on a copy that is forced
        // to wrap must report more than one line. Without it, a metric that
        // had become stuck at 1 would pass every locale silently.
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
      // CONTROL first: the metric can report a wrap, so [1, 1] is a
      // measurement rather than a constant.
      expect(box.wrapsWhenForced).toBe(true);
      expect(box.lines).toEqual([1, 1]);
      // The same claim from the other side: an item that wrapped would be
      // taller than one row, and nothing here fixes its height.
      expect(box.itemHeights).toEqual([34, 34]);
      expect(box.hitInsideSecondItem).toBe(true);
    });
  }
});
