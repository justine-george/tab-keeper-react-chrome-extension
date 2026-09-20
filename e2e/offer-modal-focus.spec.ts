import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-243. The two offer modals open with focus on the DIALOG, not on their
// CTA.
//
// showModal() lands focus on the first control, and on a page with no pointer
// interaction yet Chrome paints its :focus-visible ring on it -- so both
// prompts opened with a blue ring around the CTA, and Enter, before anyone had
// read the note, opened the Web Store or requested the permission. Measured:
// `autofocus` on the dialog changes nothing in Chromium 151; an explicit
// focus() after showModal() is what lands on the dialog itself.
//
// Focus still moves INTO the modal (that is what makes it modal), a screen
// reader still announces it by title and description, and the first Tab
// reaches the CTA with its ring -- which is the control for "nothing lit":
// a page where focus-visible simply never fires would pass the first
// assertion and fail the second.

const state = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const dialog = document.querySelector('dialog[open]');
    return {
      focusedTag: el?.tagName ?? null,
      focusedIsDialog: el === dialog,
      focusedIsFocusVisible: el?.matches(':focus-visible') ?? false,
      dialogOutline: dialog ? getComputedStyle(dialog).outlineStyle : null,
      litInside: dialog
        ? Array.from(dialog.querySelectorAll('*')).filter((n) =>
            n.matches(':focus-visible')
          ).length
        : -1,
    };
  });

async function openRatePrompt(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSettings(context, {
    extensionInstalledTime: Date.now() - 2 * 24 * 60 * 60 * 1000,
    lastValueMomentTime: Date.now() - 60 * 60 * 1000,
  });
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('dialog')).toBeVisible();
  return page;
}

// The offer is gated on real tab groups existing (see i18n-layout.spec.ts).
async function openTabGroupsPrompt(
  context: BrowserContext,
  serviceWorker: Worker,
  extensionId: string
): Promise<Page> {
  const groupCount = await serviceWorker.evaluate(async () => {
    const newTab = () =>
      new Promise<chrome.tabs.Tab>((resolve) =>
        chrome.tabs.create({ url: 'about:blank', active: false }, resolve)
      );
    const [a, b] = [await newTab(), await newTab()];
    await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
    const tabs = await chrome.tabs.query({});
    return new Set(
      tabs.map((t) => t.groupId).filter((g) => g !== undefined && g !== -1)
    ).size;
  });
  expect(groupCount, 'fixture must create a real tab group').toBe(1);
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('dialog')).toBeVisible();
  return page;
}

for (const [which, cta, open] of [
  [
    'the rate-and-review prompt',
    'Rate this extension',
    (c: BrowserContext, _w: Worker, id: string) => openRatePrompt(c, id),
  ],
  [
    'the tab groups offer',
    'Enable tab group support',
    (c: BrowserContext, w: Worker, id: string) => openTabGroupsPrompt(c, w, id),
  ],
] as const) {
  test.describe(which, () => {
    test('opens with focus on the dialog and nothing lit', async ({
      context,
      serviceWorker,
      extensionId,
    }) => {
      const page = await open(context, serviceWorker, extensionId);

      const s = await state(page);
      expect(s.focusedTag).toBe('DIALOG');
      expect(s.focusedIsDialog).toBe(true);
      expect(s.litInside).toBe(0);
      // The container is never Tab-reachable, so its own ring is off.
      expect(s.dialogOutline).toBe('none');
    });

    test('CONTROL: the first Tab reaches the CTA, lit', async ({
      context,
      serviceWorker,
      extensionId,
    }) => {
      const page = await open(context, serviceWorker, extensionId);

      await page.keyboard.press('Tab');
      const focused = page.locator(':focus');
      await expect(focused).toHaveRole('button');
      await expect(focused).toHaveAccessibleName(cta);
      expect((await state(page)).focusedIsFocusVisible).toBe(true);
    });

    test('Enter on open changes nothing', async ({
      context,
      serviceWorker,
      extensionId,
    }) => {
      const page = await open(context, serviceWorker, extensionId);
      const pagesBefore = context.pages().length;

      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      await expect(page.getByRole('dialog')).toBeVisible();
      expect(context.pages().length).toBe(pagesBefore);
    });
  });
}
