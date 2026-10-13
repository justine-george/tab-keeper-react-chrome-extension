import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';

// KAN-565 (pick B) on the real artifact. The full view opened with no tab
// groups offers nothing; a group made since is offered when the user comes
// back to the tab, once. Playwright never fires visibilitychange on a tab
// switch (devtools-harnesses-pin-visibility), so the return is staged in the
// page: hidden, then visible. The group is Chrome's own.

const offer = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Tab Keeper can save tab groups',
    exact: true,
  });

const comeBack = (page: Page) =>
  page.evaluate(() => {
    let state: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });

test('a group made after the full view opened is offered on the return, once (KAN-565)', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  // PREMISE: the load had nothing to offer.
  await expect(page.locator('html')).toHaveAttribute('data-first-open', 'none');
  // CONTROL: a return with no group open offers nothing.
  await comeBack(page);
  await page.waitForTimeout(300);
  await expect(offer(page)).toHaveCount(0);

  await serviceWorker.evaluate(async () => {
    const win = await chrome.windows.create({
      focused: false,
      url: [
        'data:text/html,<title>One</title>',
        'data:text/html,<title>Two</title>',
      ],
    });
    const [first, ...rest] = (win?.tabs ?? []).flatMap((t) =>
      t.id === undefined ? [] : [t.id]
    );
    if (first === undefined) throw new Error('Chrome gave no tab ids');
    await chrome.tabs.group({ tabIds: [first, ...rest] });
  });
  // Made, but the user has not come back yet.
  await page.waitForTimeout(300);
  await expect(offer(page)).toHaveCount(0);

  await comeBack(page);
  await expect(offer(page)).toBeVisible();
  await offer(page)
    .getByRole('button', { name: 'Not now', exact: true })
    .click();
  await expect(offer(page)).toHaveCount(0);

  // Once per load: the next return stays quiet.
  await comeBack(page);
  await page.waitForTimeout(300);
  await expect(offer(page)).toHaveCount(0);
});
