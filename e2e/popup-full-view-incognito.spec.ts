// KAN-923 in a real popup: Open full view is absent over an incognito window, and stays over a normal one.

import type { Page, Worker } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { allowInIncognito } from './fixtures/incognito';

const SETTLE = { timeout: 15_000 };

// Playwright can't reach the popup, so a Tab Keeper tab reads it. A second openPopup is refused, so one a test.
const openPopupOver = async (worker: Worker, windowId: number) => {
  // A window still settling refuses with "Failed to open popup."
  await expect(async () => {
    await worker.evaluate(async (id) => {
      await chrome.windows.update(id, { focused: true });
      await chrome.action.openPopup({ windowId: id });
    }, windowId);
  }).toPass(SETTLE);
};

const fullViewButton = (page: Page) =>
  page.evaluate(() => {
    const [view] = chrome.extension.getViews({ type: 'popup' });
    if (view === undefined) return 'no popup';
    return view.document.querySelector('[aria-label="Open full view"]') === null
      ? 'absent'
      : 'shown';
  });

for (const [kind, incognito, seen] of [
  ['incognito', true, 'absent'],
  ['normal', false, 'shown'],
] as const) {
  test(`over a ${kind} window, Open full view is ${seen}`, async ({
    context,
    extensionId,
  }) => {
    const worker = await allowInIncognito(context, extensionId);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    const windowId = await worker.evaluate(async (wanted) => {
      const made = await chrome.windows.create({
        incognito: wanted,
        focused: true,
      });
      return made?.id ?? -1;
    }, incognito);

    await openPopupOver(worker, windowId);
    await expect.poll(() => fullViewButton(page), SETTLE).toBe(seen);
    // PREMISE: the popup has read its window, so the answer is settled, not early.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const [view] = chrome.extension.getViews({ type: 'popup' });
            const inView: typeof chrome = Reflect.get(view, 'chrome');
            return (await inView.windows.getCurrent()).incognito;
          }),
        SETTLE
      )
      .toBe(incognito);
    await page.waitForTimeout(500);
    expect(await fullViewButton(page)).toBe(seen);
  });
}
