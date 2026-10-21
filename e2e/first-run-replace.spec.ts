import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  FULL_RUN,
  POPUP_RUN,
  card,
  cardAt,
  cardButton,
  cardSide,
  closeReplayNote,
  landedAt,
  nextTo,
  openRunFromHelp,
  storedRun,
} from './fixtures/run';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

// KAN-586. The run explains the row's Replace in its own step, after Switch
// (popup) or Open (full view), and Replace waits for the tour on the run's
// session, as Open and Switch do (KAN-413).

const TEXT =
  'Replace keeps this saved session up to date by overwriting it with what you have open now. Nothing closes.';

// Two stand-in pages: Gmail is saved as the run's session, Docs opens after.
async function stub(context: BrowserContext, url: string, title: string) {
  await context.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<title>${title}</title>`,
    })
  );
  await (await context.newPage()).goto(url);
}

// The stored tab titles of one session.
async function tabTitles(page: Page, id: string): Promise<string[]> {
  const parsed: unknown = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')
  );
  if (!isValidTabMasterContainer(parsed)) return [];
  const session = parsed.tabGroups.find((g) => g.tabGroupId === id);
  return (session?.windows ?? []).flatMap((w) => w.tabs.map((t) => t.title));
}

const replaceOf = (page: Page, id: string) =>
  page.locator(
    `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-tour-anchor="row-replace"]`
  );

test('popup: step 5 explains Replace under the row’s Replace, which waits for the tour; after Done it replaces', async ({
  context,
  extensionId,
}) => {
  await stub(context, 'https://mail.google.com/mail/u/0/', 'Inbox – Gmail');
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await page
    .locator('[data-tour-anchor="save"]')
    .getByRole('button', {
      name: 'Save all open windows as a session',
      exact: true,
    })
    .click();
  await expect(cardAt(page, 2)).toBeVisible();
  const run = await storedRun(page);
  const own =
    typeof run === 'object' && run !== null
      ? Reflect.get(run, 'sessionId')
      : null;
  if (typeof own !== 'string') throw new Error('the run has no session');
  await expect
    .poll(() => tabTitles(page, own))
    .toEqual(expect.arrayContaining(['Inbox – Gmail']));
  const saved = await tabTitles(page, own);
  expect(saved).not.toContain('Docs');
  // Opened after the save, so a Replace that acted would add it.
  await stub(context, 'https://docs.google.com/document/d/x', 'Docs');
  await page.bringToFront();

  for (let step = 3; step <= 5; step++) await nextTo(page, step);
  await landedAt(page, 5);
  await expect(card(page)).toContainText(TEXT);
  expect(await cardSide(page)).toBe('below');
  const replace = replaceOf(page, own);
  const [button, box] = await Promise.all([
    replace.boundingBox(),
    card(page).boundingBox(),
  ]);
  if (button === null || box === null) throw new Error('nothing drawn');
  // Below the button, overlapping it across.
  expect(box.y).toBeGreaterThanOrEqual(button.y + button.height);
  expect(box.x).toBeLessThan(button.x + button.width);
  expect(box.x + box.width).toBeGreaterThan(button.x);
  // Lit, and still waiting.
  expect(
    await replace.evaluate((el) => [
      getComputedStyle(el).filter,
      el.getAttribute('aria-disabled'),
    ])
  ).toEqual(['none', 'true']);

  // The scrim stops the pointer at every step, but not the keyboard: focus can
  // reach Replace behind it. At the next step it is dimmed; Enter on it, with
  // focus on it (premise), replaces nothing.
  await nextTo(page, 6);
  await landedAt(page, 6);
  expect(
    await replace.evaluate((el) => [
      getComputedStyle(el).filter,
      el.getAttribute('aria-disabled'),
    ])
  ).toEqual(['opacity(0.3)', 'true']);
  await replace.focus();
  expect(await replace.evaluate((el) => document.activeElement === el)).toBe(
    true
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(await tabTitles(page, own)).toEqual(saved);

  for (let step = 7; step <= 8; step++) await nextTo(page, step);
  await cardButton(page, 'Done').click();
  await closeReplayNote(page);
  await expect(card(page)).toHaveCount(0);

  // CONTROL: the same press after the tour replaces it with what is open.
  await expect(replace).not.toHaveAttribute('aria-disabled');
  await replace.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => tabTitles(page, own))
    .toEqual(expect.arrayContaining(['Inbox – Gmail', 'Docs']));
});

test('full view: step 6 explains Replace under the row’s Replace, after Open, before Delete', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  for (let step = 2; step <= 3; step++) await nextTo(page, step);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  // KAN-735 CONTROL: with no saved sessions, step 4 is the first to name the list.
  await expect(card(page).locator('p').first()).toHaveText(
    'Here are your saved sessions. The selected one shows its windows and tabs on the right.'
  );
  await nextTo(page, 5);
  await expect(card(page)).toContainText('Open brings back');
  await nextTo(page, 6);
  await landedAt(page, 6);
  await expect(card(page)).toContainText(TEXT);
  expect(await cardSide(page)).toBe('below');
  await expect(cardAt(page, 6)).toBeVisible();
  await nextTo(page, 7);
  await expect(card(page)).toContainText('Copy all links, export, or delete');
  await expect(card(page)).toContainText(
    "Right-clicking the session's title opens this menu too."
  );
});
