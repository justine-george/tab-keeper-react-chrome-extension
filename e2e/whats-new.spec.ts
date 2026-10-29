import type { BrowserContext, Page, Worker } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import { POPUP, openFullView, openPopup } from './fixtures/onboarding';
import { seedSettings } from './fixtures/seed';

// KAN-861. What's new on the first open after an update.
// Playwright cannot make Chrome report an update (a folder swap reads as an
// install), so the key the worker records is seeded in the worker; the
// worker's own record is unit-tested. The build's manifest is 2.0.1 until the
// cut, so 'next' reads as 2.0.1. Revisit when a second release joins the list.

const SINCE = '2.0.0';
const TITLE = "What's new in Tab Keeper 2.0.1";

const sinceIn = (worker: Worker) =>
  worker.evaluate(async () => {
    const items = await chrome.storage.local.get('whatsNewSince');
    return items.whatsNewSince ?? null;
  });

// Before the first page opens: what an update leaves behind.
const updatedFrom = (worker: Worker, version: string) =>
  worker.evaluate(
    (v) => chrome.storage.local.set({ whatsNewSince: v }),
    version
  );

const whatsNew = (page: Page) =>
  page.getByRole('dialog', { name: TITLE, exact: true });

test.describe("What's new (KAN-861)", () => {
  test('a fresh install shows nothing', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPopup(context, extensionId);
    await expect(page.locator('html[data-first-open]')).toHaveCount(1);

    expect(await page.locator('html').getAttribute('data-first-open')).not.toBe(
      'whatsNew'
    );
    await expect(page.locator('dialog[data-whats-new]')).toHaveCount(0);
    expect(await sinceIn(serviceWorker)).toBeNull();
  });

  test('closed unanswered, the next open shows it again', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await updatedFrom(serviceWorker, SINCE);
    const first = await openPopup(context, extensionId);
    await expect(whatsNew(first)).toBeVisible();
    await first.close();

    const next = await openPopup(context, extensionId);
    await expect(whatsNew(next)).toBeVisible();
    expect(await sinceIn(serviceWorker)).toBe(SINCE);
  });

  test('Got it clears it; the next open shows nothing', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await updatedFrom(serviceWorker, SINCE);
    const page = await openPopup(context, extensionId);
    await whatsNew(page).getByRole('button', { name: 'Got it' }).click();
    await expect(whatsNew(page)).toBeHidden();
    await expect.poll(() => sinceIn(serviceWorker)).toBeNull();
    await page.close();

    const next = await openPopup(context, extensionId);
    await expect(next.locator('html[data-first-open]')).toHaveCount(1);
    await expect(next.locator('dialog[data-whats-new]')).toHaveCount(0);
  });

  test('Open Settings lands on Settings › Sessions', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await updatedFrom(serviceWorker, SINCE);
    const page = await openPopup(context, extensionId);
    await whatsNew(page).getByRole('button', { name: 'Open Settings' }).click();

    await expect(page.getByRole('group', { name: 'Copy links' })).toBeVisible();
    await expect(whatsNew(page)).toBeHidden();
    await expect.poll(() => sinceIn(serviceWorker)).toBeNull();
  });

  test('the full view shows it too', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await updatedFrom(serviceWorker, SINCE);
    const page = await openFullView(context, extensionId);
    await expect(whatsNew(page)).toBeVisible();
  });

  test('answering in the full view closes it in the popup', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await updatedFrom(serviceWorker, SINCE);
    const popup = await openPopup(context, extensionId);
    const full = await openFullView(context, extensionId);
    await expect(whatsNew(popup)).toBeVisible();
    await expect(whatsNew(full)).toBeVisible();

    await whatsNew(full).getByRole('button', { name: 'Got it' }).click();

    await expect(whatsNew(popup)).toBeHidden();
  });
});

// Before the app's first render, as Chrome's font-size setting would be.
async function rootAt(context: BrowserContext, px: number) {
  await context.addInitScript((size: number) => {
    if (window.top !== window) return;
    const apply = () => {
      const root = document.documentElement;
      if (root === null) return false;
      root.style.fontSize = `${size}px`;
      return true;
    };
    if (!apply()) {
      new MutationObserver((_, observer) => {
        if (apply()) observer.disconnect();
      }).observe(document, { childList: true });
    }
  }, px);
}

// The popup in whatever language is on screen: not openPopup's English label.
async function popupIn(
  context: BrowserContext,
  extensionId: string,
  viewport = POPUP
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[data-pane="sessions"]').waitFor();
  return page;
}

const box = (page: Page) =>
  page.locator('dialog[data-whats-new]').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const scroll = dialog.querySelector('[data-whats-new-scroll]');
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      cap: window.innerHeight - 48,
      scrolls: scroll === null || scroll.scrollHeight > scroll.clientHeight,
    };
  });

test.describe("What's new fits the popup (KAN-861)", () => {
  test.describe.configure({ mode: 'parallel' });

  for (const [name, language, rootPx] of [
    ['de', 'de', null],
    ['ru', 'ru', null],
    ['Large font', 'en', 20],
  ] as const) {
    test(`${name} at 790 × 550`, async ({
      context,
      extensionId,
      serviceWorker,
    }, testInfo) => {
      if (rootPx !== null) await rootAt(context, rootPx);
      await seedSettings(context, { language });
      await updatedFrom(serviceWorker, SINCE);
      const page = await popupIn(context, extensionId);
      await expect(page.locator('dialog[data-whats-new]')).toBeVisible();
      // The language took: the title is this locale's own.
      await expect(page.locator('#whats-new-title')).toHaveText(
        localeStrings(language)["What's new in Tab Keeper {{version}}"].replace(
          '{{version}}',
          '2.0.1'
        )
      );

      const fit = await box(page);
      testInfo.annotations.push({
        type: 'fit',
        description: `${name}: dialog ${Math.round(fit.height)}px, ${Math.round(
          fit.cap - fit.height
        )}px under the 100vh - 48px cap`,
      });
      expect(fit.top).toBeGreaterThanOrEqual(0);
      expect(fit.bottom).toBeLessThanOrEqual(POPUP.height);
      expect(fit.scrolls).toBe(false);
    });
  }
});

test.describe("What's new in a short window (KAN-861)", () => {
  test.use({ showScrollbars: true });

  test('the list scrolls, and the title and Got it stay in view', async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    await updatedFrom(serviceWorker, SINCE);
    const page = await popupIn(context, extensionId, {
      width: 790,
      height: 200,
    });
    const dialog = whatsNew(page);
    await expect(dialog).toBeVisible();

    expect((await box(page)).scrolls).toBe(true);
    await expect(dialog.getByRole('heading', { name: TITLE })).toBeInViewport({
      ratio: 1,
    });
    await expect(dialog.getByRole('button', { name: 'Got it' })).toBeInViewport(
      {
        ratio: 1,
      }
    );
    await testInfo.attach('whats-new-short-window', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
