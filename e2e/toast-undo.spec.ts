import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { POPUP, TAB_VIEW, stored } from './fixtures/savedWindows';

// KAN-583 on the real artifact: "Session deleted." and "Session replaced…" offer Undo, which steps
// back as ⌘Z does; only the newest change's toast keeps it (L1); Undo toasts keep the 300px width
// and wrap (W2), where a grown one crossed the popup's divider and was cut off in French.

const TRIP = buildSession({ tabGroupId: 's-trip', title: 'Trip' });
const OTHER = buildSession({ tabGroupId: 's-other', title: 'Other' });

async function openOn(
  context: BrowserContext,
  extensionId: string,
  {
    view = 'popup',
    language = 'en',
  }: { view?: 'popup' | 'tab'; language?: string } = {}
): Promise<Page> {
  await seedSettings(context, { language });
  await seedSessions(context, {
    ...buildContainer([OTHER, TRIP]),
    selectedTabGroupId: 's-trip',
  });
  const page = await context.newPage();
  await page.setViewportSize(view === 'popup' ? POPUP : TAB_VIEW);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${view === 'tab' ? '?view=tab' : ''}`
  );
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const undoButton = (page: Page, name = 'Undo'): Locator =>
  page.getByRole('status').getByRole('button', { name, exact: true });

const ids = async (page: Page) =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);
const tripUrls = async (page: Page) =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === 's-trip')
    ?.windows.flatMap((w) => w.tabs.map((t) => t.url));

async function deleteShown(page: Page): Promise<void> {
  await page
    .locator('[data-pane="detail"] [data-tour-anchor="session-menu"]')
    .locator('[aria-haspopup="menu"]')
    .click();
  await page.getByRole('menuitem', { name: 'Delete session' }).click();
}

const replaceShown = (page: Page) =>
  page.locator('[data-tour-anchor="row-replace"]').first().click();

const openWindow = (worker: Worker, titles: string[]) =>
  worker.evaluate(
    async (urls) =>
      (await chrome.windows.create({ focused: false, url: urls }))?.id ?? null,
    titles.map((t) => `data:text/html,<title>${t}</title>`)
  );

test('Undo on "Session deleted." brings the session back and closes the toast', async ({
  context,
  extensionId,
}) => {
  const page = await openOn(context, extensionId);
  await deleteShown(page);
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText('Session deleted.');
  await expect(undoButton(page)).toHaveAttribute(
    'aria-keyshortcuts',
    /^(Meta|Control)\+Z$/
  );
  await expect.poll(() => ids(page)).toEqual(['s-other']);

  await undoButton(page).click();

  await expect.poll(() => ids(page)).toContain('s-trip');
  await expect(toasts(page)).toHaveCount(0);
});

test('Undo on "Session replaced…" puts back the old windows', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openOn(context, extensionId);
  const before = await tripUrls(page);
  await openWindow(serviceWorker, ['News']);
  await replaceShown(page);
  await expect.poll(() => tripUrls(page)).not.toEqual(before);

  await undoButton(page).click();

  await expect.poll(() => tripUrls(page)).toEqual(before);
  await expect(toasts(page)).toHaveCount(0);
});

test('⌘Z undoes the delete and closes its toast', async ({
  context,
  extensionId,
}) => {
  const page = await openOn(context, extensionId);
  await deleteShown(page);
  await expect(undoButton(page)).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(() => ids(page)).toContain('s-trip');
  await expect(toasts(page)).toHaveCount(0);
});

test('Replace then Delete: the Replace toast stays without Undo, and Undo takes back only the Delete', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openOn(context, extensionId);
  await openWindow(serviceWorker, ['News']);
  await replaceShown(page);
  await expect(undoButton(page)).toHaveCount(1);
  const replaced = await tripUrls(page);
  // Delete the session the Replace changed, so one undo too many would show.
  await deleteShown(page);
  await expect(toasts(page)).toHaveCount(2);

  await expect(undoButton(page)).toHaveCount(1);
  await undoButton(page).click();

  await expect.poll(() => tripUrls(page)).toEqual(replaced);
  await expect(toasts(page)).toHaveCount(1);
});

test('a Reopen offer before the delete gives ⌘Z to Undo; Reopen keeps its button', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openOn(context, extensionId, { view: 'tab' });
  await page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: 'Trip', exact: true })
    .click({ position: { x: 20, y: 8 } });
  const id = await openWindow(serviceWorker, ['Keep', 'Drop']);
  const block = page.locator(
    `[data-pane="open-now"] [data-open-window-id="${id}"]`
  );
  await expect(
    block.getByRole('button', { name: /^Switch to tab: / })
  ).toHaveCount(2);
  await block
    .getByRole('button', { name: 'Close tab: Drop', exact: true })
    .click();
  await expect(undoButton(page, 'Reopen')).toHaveAttribute(
    'aria-keyshortcuts',
    /^(Meta|Control)\+Z$/
  );

  await deleteShown(page);

  await expect(undoButton(page)).toHaveAttribute(
    'aria-keyshortcuts',
    /^(Meta|Control)\+Z$/
  );
  await expect(undoButton(page, 'Reopen')).not.toHaveAttribute(
    'aria-keyshortcuts'
  );
});

test('W2: in French the Replace toast stays inside the popup’s left pane and shows its whole message', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openOn(context, extensionId, { language: 'fr' });
  await openWindow(serviceWorker, ['News']);
  await replaceShown(page);
  const toast = toasts(page);
  await expect(toast).toContainText(
    'Session remplacée par toutes les fenêtres ouvertes.'
  );
  // Settled: the rise has finished.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector('[role="status"]')
            ?.getAnimations({ subtree: true }).length ?? -1
      )
    )
    .toBe(0);

  const toastBox = await toast.boundingBox();
  const paneBox = await page.locator('[data-pane="sessions"]').boundingBox();
  if (toastBox === null || paneBox === null) throw new Error('no box');
  expect(toastBox.width).toBeCloseTo(300, 0);
  expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(
    paneBox.x + paneBox.width
  );
  // Not cut off: the message is as wide as its box.
  const cut = await toast
    .locator('span')
    .first()
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(cut).toBe(false);
});
