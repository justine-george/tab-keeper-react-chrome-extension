import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openFullView } from './fixtures/onboarding';
import { storedTitles } from './fixtures/run';

// §8 on the real build: the store and New Tab name nothing. Chromium kills a tab whose store page is
// route-fulfilled, so the store specs load the real store and need network.

const STORE = 'https://chromewebstore.google.com/detail/tab-keeper/abc';
const GMAIL = 'https://mail.google.com/mail/u/0/';

test.beforeEach(async ({ context }) => {
  await context.route(GMAIL, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<title>Inbox – Gmail</title>',
    })
  );
});

// The left pane's save; Open now's save-all carries the same name.
const emptySave = (page: Page) =>
  page
    .locator('[data-pane="sessions"]')
    .getByRole('button', {
      name: 'Save all open windows as a session',
      exact: true,
    })
    .click();

test('full view: the store most recent and Gmail behind it: the empty save is named after Gmail', async ({
  context,
  extensionId,
}) => {
  const gmail = await context.newPage();
  await gmail.goto(GMAIL);
  const store = await context.newPage();
  await store.goto(STORE);
  const full = await openFullView(context, extensionId);
  await emptySave(full);
  await expect.poll(() => storedTitles(full)).toEqual(['Inbox – Gmail']);
});

test('full view: only the store and Tab Keeper: New Tab Group', async ({
  context,
  extensionId,
}) => {
  for (const page of context.pages()) await page.goto(STORE);
  const full = await openFullView(context, extensionId);
  await emptySave(full);
  await expect.poll(() => storedTitles(full)).toEqual(['New Tab Group']);
});

test('full view: a New Tab most recent and Gmail behind it: named after Gmail', async ({
  context,
  extensionId,
}) => {
  const gmail = await context.newPage();
  await gmail.goto(GMAIL);
  const newTab = await context.newPage();
  await newTab.goto('chrome://newtab/');
  const full = await openFullView(context, extensionId);
  await emptySave(full);
  await expect.poll(() => storedTitles(full)).toEqual(['Inbox – Gmail']);
});
