import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  seedSessions,
  seedSettingsIfAbsent,
} from './fixtures/seed';
import {
  THEMES,
  openFullView,
  openPopup,
  pageGround,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';

// KAN-7 §6 on the real build. Fresh profiles with seed-if-absent, so a reopen
// sees what the last page wrote. <html data-first-open> is the barrier: the
// callout is the popup's last entry, so nothing else says the queue is done.

const DAY = 24 * 60 * 60 * 1000;
const callout = (page: Page) => page.locator('[data-full-view-callout]');
const expand = (page: Page) =>
  page.getByRole('button', { name: 'Open full view', exact: true });
const queueDone = (page: Page, opened: string) =>
  expect(page.locator('html')).toHaveAttribute('data-first-open', opened);

async function sessionHolder(
  context: BrowserContext,
  settings: Record<string, unknown> = {}
): Promise<void> {
  await seedSessions(context, buildContainer());
  await seedSettingsIfAbsent(context, {
    isFullViewCalloutSeen: false,
    ...settings,
  });
}

// Records the callout the moment it is inserted, from document start.
async function watchCallout(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__calloutSeen', {
      value: seen,
      configurable: true,
    });
    new MutationObserver(() => {
      if (
        document.querySelector('[data-full-view-callout]') &&
        seen.length === 0
      ) {
        seen.push('callout');
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const calloutSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__calloutSeen');
    return Array.isArray(seen) ? seen.map(String) : [];
  });

test.describe('the full-view callout (KAN-7 §6)', () => {
  test.use({ freshProfile: true });

  for (const rootPx of [16, 20]) {
    test(`at a ${rootPx}px root: under ⤢, whole, uncovered, and the focus untouched`, async ({
      context,
      extensionId,
    }) => {
      await sessionHolder(context);
      const page = await openPopup(context, extensionId);
      await page.evaluate((px) => {
        document.documentElement.style.fontSize = `${px}px`;
      }, rootPx);
      await expect(
        page.getByRole('dialog', {
          name: 'See your saved sessions and open tabs side by side.',
          exact: true,
        })
      ).toBeVisible();

      const anchor = await expand(page).boundingBox();
      const box = await callout(page).boundingBox();
      if (anchor === null || box === null) throw new Error('no boxes');
      expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(790);
      expect(box.y + box.height).toBeLessThanOrEqual(550);
      expect(
        await page.evaluate(() => {
          const el = document.querySelector('[data-full-view-callout]');
          if (el === null) return false;
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(
              r.left + r.width / 2,
              r.top + r.height / 2
            )
          );
        })
      ).toBe(true);
      expect(
        await page.evaluate(() => document.activeElement === document.body)
      ).toBe(true);
    });
  }

  for (const how of ['Try it', 'Close', 'Escape', 'Open full view'] as const) {
    test(`${how} marks it seen, and it never comes back`, async ({
      context,
      extensionId,
    }) => {
      await sessionHolder(context);
      const page = await openPopup(context, extensionId);
      await expect(callout(page)).toBeVisible();

      if (how === 'Escape') await page.keyboard.press('Escape');
      else if (how === 'Open full view') await expand(page).click();
      else
        await callout(page)
          .getByRole('button', { name: how, exact: true })
          .click();

      await expect(callout(page)).toHaveCount(0);
      expect((await storedSettings(page)).isFullViewCalloutSeen).toBe(true);
      if (how === 'Try it' || how === 'Open full view')
        await waitForFullView(context);

      const again = await openPopup(context, extensionId);
      await queueDone(again, 'none');
      await expect(callout(again)).toHaveCount(0);
    });
  }

  test('never on an open that showed a dialog', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await watchCallout(context);
    // Two live tab groups and no grant: the tab-groups offer takes the open.
    await serviceWorker.evaluate(async () => {
      const newTab = () =>
        chrome.tabs.create({ url: 'about:blank', active: false });
      const [a, b] = [await newTab(), await newTab()];
      await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
    });
    await sessionHolder(context);
    const page = await openPopup(context, extensionId);
    await expect(page.getByRole('dialog')).toBeVisible();
    await queueDone(page, 'tabGroups');
    expect(await calloutSeen(page)).toEqual([]);
  });

  // KAN-653. One card at a time: a review ask due on this open waits until
  // the callout has been dealt with.
  test('the review card waits for the callout', async ({
    context,
    extensionId,
  }) => {
    await sessionHolder(context, {
      isNeverAskAgainToRate: false,
      extensionInstalledTime: Date.now() - 2 * DAY,
    });
    const page = await openPopup(context, extensionId);
    await expect(callout(page)).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('review-card')).toHaveCount(0);

    await callout(page)
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(
      page.getByRole('complementary', {
        name: 'Thanks for using Tab Keeper',
        exact: true,
      })
    ).toBeVisible();
  });

  test('an Esc that closes a modal dialog leaves the callout open and unseen', async ({
    context,
    extensionId,
  }) => {
    await sessionHolder(context, { cloudConsent: 'declined' });
    const page = await openPopup(context, extensionId);
    await expect(callout(page)).toBeVisible();

    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    const consent = page.getByRole('dialog', {
      name: 'Sync your sessions across devices?',
      exact: true,
    });
    await expect(consent).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(consent).toHaveCount(0);
    await expect(callout(page)).toBeVisible();
    expect((await storedSettings(page)).isFullViewCalloutSeen).toBe(false);
  });

  test('CONTROL: the same observer sees it on an open that shows it', async ({
    context,
    extensionId,
  }) => {
    await watchCallout(context);
    await sessionHolder(context);
    const page = await openPopup(context, extensionId);
    await queueDone(page, 'fullViewCallout');
    expect(await calloutSeen(page)).toEqual(['callout']);
  });

  for (const [name, settings] of [
    ['Open now dragged before KAN-7', { openNowWidth: 480 }],
    [
      'the saved session unfolded before KAN-7',
      { foldSavedSessionInTabView: false },
    ],
  ] as const) {
    test(`not after ${name}`, async ({ context, extensionId }) => {
      await sessionHolder(context, settings);
      const page = await openPopup(context, extensionId);
      await queueDone(page, 'none');
      await expect(callout(page)).toHaveCount(0);
    });
  }

  test('not once the full view has been opened here', async ({
    context,
    extensionId,
  }) => {
    await sessionHolder(context);
    const full = await openFullView(context, extensionId);
    await queueDone(full, 'none');
    await expect(callout(full)).toHaveCount(0);

    const page = await openPopup(context, extensionId);
    await queueDone(page, 'none');
    await expect(callout(page)).toHaveCount(0);
  });

  for (const [theme, palette] of THEMES) {
    test(`${theme}: it reads at 4.5:1`, async ({ context, extensionId }) => {
      await sessionHolder(context, { theme });
      const page = await openPopup(context, extensionId);
      expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
      await expectReadable(callout(page), `${theme} full-view callout`);
    });
  }
});
