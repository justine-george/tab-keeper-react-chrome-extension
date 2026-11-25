import { type BrowserContext, type Page } from '@playwright/test';

import { hasCloudConfig } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession } from './fixtures/seed';

// Syncs with the dev cloud.
test.use({ cloud: true });

// KAN-1016, against the real dev cloud, on one device. A redo stamps a session
// past the copy it replaces; the snapshot in history keeps the older stamp. An
// undo of a later edit elsewhere handed that older stamp back, the cloud's
// newer copy won the next merge, and the popup said "Synced changes from
// another device." and cleared undo -- with no other device anywhere.
//
// Needs a build that carries the Firebase config (a local build with a .env).
// PR CI builds without one (KAN-147), so it skips there.

const COMMIT = /firestore\.googleapis\.com\/.*documents:commit/;
const TOAST = 'Synced changes from another device.';

const A = buildSession({ tabGroupId: 'a', title: 'Alpha', isSelected: true });
const B = buildSession({ tabGroupId: 'b', title: 'Bravo' });

async function seedOnce(context: BrowserContext): Promise<void> {
  const container = buildContainer([A, B]);
  container.selectedTabGroupId = A.tabGroupId;
  await context.addInitScript((value: string) => {
    try {
      if (window.localStorage.getItem('e2e-seeded') !== null) return;
      window.localStorage.setItem('e2e-seeded', '1');
      window.localStorage.setItem('tabContainerData', value);
    } catch {
      // Storage blocked; the assertions below say so more clearly.
    }
  }, JSON.stringify(container));
}

// Resolves on this step's own write, so each step is in the cloud before the next.
async function step(
  page: Page,
  label: string,
  act: () => Promise<void>
): Promise<void> {
  await test.step(label, async () => {
    const commit = page.waitForRequest(COMMIT, { timeout: 20_000 });
    await act();
    await commit;
    await page.waitForTimeout(1_500); // let the sync's merge settle
  });
}

async function rename(page: Page, from: string, to: string): Promise<void> {
  // Rename lives on the selected session; selecting is no undo step.
  // By its title's corner: the row's middle is under its hover actions.
  await page
    .getByRole('button', { name: from, exact: true })
    .click({ position: { x: 12, y: 12 } });
  await page.getByRole('button', { name: `Rename session: ${from}` }).click();
  const input = page.locator('input:focus');
  await input.fill(to);
  await input.press('Enter');
  await expect(
    page.getByRole('button', { name: to, exact: true })
  ).toBeVisible();
}

const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

const opacityOf = (page: Page, name: string) =>
  button(page, name).evaluate((el) => getComputedStyle(el).opacity);

test('rename, undo, redo, save, undo: no "another device" toast, undo kept (KAN-1016)', async ({
  context,
  extensionId,
}, testInfo) => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(120_000); // five synced steps, each waited out
  await seedOnce(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  let toasts = 0;
  const startup = page.waitForRequest(COMMIT, { timeout: 20_000 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await startup;
  await page.waitForTimeout(2_000);
  // Counted as they appear: a toast lasts seconds, a single read could miss it.
  await page.exposeFunction('sawToast', () => (toasts += 1));
  await page.evaluate((text) => {
    new MutationObserver(() => {
      if (document.body.innerText.includes(text)) {
        (window as unknown as { sawToast: () => void }).sawToast();
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, TOAST);

  await step(page, 'rename Alpha', () => rename(page, 'Alpha', 'Alpha 2'));
  await step(page, 'undo', () => button(page, 'Undo').click());
  await expect(button(page, 'Alpha')).toBeVisible();
  await step(page, 'redo', () => button(page, 'Redo').click());
  await expect(button(page, 'Alpha 2')).toBeVisible();
  // A new session, with no click elsewhere first: selecting a row would
  // re-record the history entry with Alpha's current stamp and hide this.
  await step(page, 'save', () =>
    button(page, 'Save all open windows as a session').click()
  );
  await expect(
    page.locator('[data-pane="sessions"] [data-drag-row-id]')
  ).toHaveCount(3);
  // Takes back the save and leaves Alpha 2 as it is.
  await step(page, 'undo save', () => button(page, 'Undo').click());
  await expect(
    page.locator('[data-pane="sessions"] [data-drag-row-id]')
  ).toHaveCount(2);
  await expect(button(page, 'Alpha 2')).toBeVisible();
  // The sync after the undo: its read is where the stale stamp lost.
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: testInfo.outputPath('after-undo.png') });

  expect(toasts, `"${TOAST}" shown on a device that syncs with nobody`).toBe(0);
  // The first rename is still there to undo: the merge did not clear history.
  expect(await opacityOf(page, 'Undo'), 'Undo still has a step').toBe('1');
});
