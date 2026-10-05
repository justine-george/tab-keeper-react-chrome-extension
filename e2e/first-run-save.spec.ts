import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openPage, POPUP, twoFrames } from './fixtures/onboarding';
import {
  FULL_RUN,
  POPUP_RUN,
  nextTo,
  card,
  cardAt,
  cardButton,
  openRunFromHelp,
  storedRun,
  storedTitles,
} from './fixtures/run';

// §8 and the first save on the real build: the prefill, the run's own save, the echo, Q3.

const GMAIL = 'https://mail.google.com/mail/u/0/';
const field = (page: Page) => page.locator('[data-tour-anchor="save"] input');
const saveAll = (page: Page) =>
  page.locator('[data-tour-anchor="save"]').getByRole('button', {
    name: 'Save all open windows as a session',
    exact: true,
  });

test.beforeEach(async ({ context }) => {
  await context.route(GMAIL, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<title>(3) Inbox – Gmail</title>',
    })
  );
});

async function popupRunBesideGmail(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const gmail = await context.newPage();
  await gmail.goto(GMAIL);
  return openRunFromHelp(context, extensionId, POPUP_RUN);
}

// Every animate() on a tab dot from now on, as its keyframes.
async function watchDotEchoes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__echoes', { value: seen });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      if (this.matches('[data-tour-anchor="tab-dot"]')) {
        seen.push(JSON.stringify(keyframes));
      }
      return animate.call(this, keyframes, options);
    };
  });
}

const echoes = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__echoes');
    if (!Array.isArray(seen)) throw new Error('no echo watch on this page');
    return seen.filter((s): s is string => typeof s === 'string');
  });

test('the field holds the name an empty save would give, and saving it is the run’s save', async ({
  context,
  extensionId,
}) => {
  const page = await popupRunBesideGmail(context, extensionId);
  await expect(field(page)).toHaveValue('Inbox – Gmail');
  await saveAll(page).click();
  await expect(cardAt(page, 2)).toBeVisible();
  await expect.poll(() => storedTitles(page)).toEqual(['Inbox – Gmail']);
  await expect(field(page)).toHaveValue('');
  // The same tabs: an empty save names a session exactly as the prefill did.
  await cardButton(page, 'Back').click();
  await expect(cardAt(page, 1)).toBeVisible();
  await saveAll(page).click();
  await expect
    .poll(() => storedTitles(page))
    .toEqual(['Inbox – Gmail', 'Inbox – Gmail']);
});

test('the first save echoes on its tab dots, and only the first', async ({
  context,
  extensionId,
}) => {
  const page = await popupRunBesideGmail(context, extensionId);
  await watchDotEchoes(page);
  await saveAll(page).click();
  await expect(cardAt(page, 2)).toBeVisible();
  await expect.poll(async () => (await echoes(page)).length).toBeGreaterThan(0);
  expect(
    (await echoes(page)).every((e) => e.includes('translateY(-3px)'))
  ).toBe(true);
  const count = (await echoes(page)).length;
  await cardButton(page, 'Back').click();
  await expect(cardAt(page, 1)).toBeVisible();
  await saveAll(page).click();
  await expect.poll(() => storedTitles(page)).toHaveLength(2);
  await twoFrames(page);
  expect((await echoes(page)).length).toBe(count);
});

test.describe('reduced motion', () => {
  // CONTROL: the previous test sees the same observer record the echo.
  test('the row appears and no dot moves', async ({ context, extensionId }) => {
    const page = await popupRunBesideGmail(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watchDotEchoes(page);
    await saveAll(page).click();
    await expect(cardAt(page, 2)).toBeVisible();
    await expect.poll(() => storedTitles(page)).toHaveLength(1);
    await twoFrames(page);
    expect(await echoes(page)).toEqual([]);
  });
});

test('Back to the save card after the run’s save: it says it saved, and Next is the way on (R6, M4)', async ({
  context,
  extensionId,
}) => {
  const page = await popupRunBesideGmail(context, extensionId);
  await saveAll(page).click();
  await expect(cardAt(page, 2)).toBeVisible();
  await cardButton(page, 'Back').click();
  await expect(cardAt(page, 1)).toBeVisible();
  await expect(card(page)).toContainText('Saved. Press');
  await expect(card(page)).toContainText(
    'any time to save your windows again.'
  );
  await expect(
    card(page).getByRole('img', {
      name: 'Save all open windows as a session',
    })
  ).toBeVisible();
  await expect(card(page).locator('p')).toHaveCount(1);
  await expect(field(page)).toHaveValue('');
  await expect(cardButton(page, 'Use an example')).toHaveCount(0);
  await cardButton(page, 'Next').click();
  await expect(cardAt(page, 2)).toBeVisible();
  expect(await storedTitles(page)).toEqual(['Inbox – Gmail']);
});

test('full view: Back to step 3 after the run’s save says it saved; Next goes to step 4 and adds no session', async ({
  context,
  extensionId,
}) => {
  const gmail = await context.newPage();
  await gmail.goto(GMAIL);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await expect(field(page)).toHaveValue('Inbox – Gmail');
  await saveAll(page).click();
  await expect(cardAt(page, 4)).toBeVisible();
  await cardButton(page, 'Back').click();
  await expect(cardAt(page, 3)).toBeVisible();
  await expect(card(page)).toContainText('Saved. Press');
  await expect(cardButton(page, 'Use an example')).toHaveCount(0);
  await cardButton(page, 'Next').click();
  await expect(cardAt(page, 4)).toBeVisible();
  expect(await storedTitles(page)).toEqual(['Inbox – Gmail']);
});

test('Q3: only Tab Keeper open, the card says so, the field holds New Tab Group, and Use an example is the only way on', async ({
  context,
  extensionId,
}) => {
  const page = await openPage(context, extensionId, POPUP_RUN.path, POPUP);
  for (const other of context.pages()) if (other !== page) await other.close();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page
    .locator('[data-help]')
    .getByRole('button', { name: 'Show me around', exact: true })
    .click();
  await expect(card(page)).toContainText('Only Tab Keeper is open right now');
  await expect(field(page)).toHaveValue('New Tab Group');
  await expect(cardButton(page, 'Next')).toHaveCount(0);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 2)).toBeVisible();
  await expect.poll(() => storedRun(page)).toMatchObject({ step: 2 });
});
