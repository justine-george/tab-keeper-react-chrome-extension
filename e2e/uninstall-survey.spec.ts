import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { POPUP, openPage } from './fixtures/onboarding';

// KAN-642. Uninstalling opens the feedback form, stamped with this build's
// version and the language Tab Keeper was showing.

const VERSION: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../dist/manifest.json', import.meta.url)),
    'utf8'
  )
).version;

const FORM = 'https://docs.google.com/forms/**';
const VERSION_ENTRY = 'entry.289476948';
const LANGUAGE_ENTRY = 'entry.19370289';

// What Chrome opens once the extension is gone. The evaluate rejects: the worker dies with it.
async function uninstallAndCatchSurvey(
  context: BrowserContext,
  worker: Worker
): Promise<URL> {
  await context.route(FORM, (route) =>
    route.fulfill({ body: 'survey stub', contentType: 'text/html' })
  );
  const opened = context.waitForEvent('page', {
    predicate: (p) => p.url().startsWith('https://docs.google.com/forms/'),
  });
  await worker
    .evaluate(() =>
      chrome.management.uninstallSelf({ showConfirmDialog: false })
    )
    .catch(() => undefined);
  return new URL((await opened).url());
}

test("installed and never opened: the version, and the browser's language", async ({
  context,
  serviceWorker,
}) => {
  // CONTROL: the 'en' below is headless Chromium's own language, mapped.
  expect(
    await serviceWorker.evaluate(() => chrome.i18n.getUILanguage())
  ).toMatch(/^en\b/);
  const url = await uninstallAndCatchSurvey(context, serviceWorker);
  expect(url.searchParams.get(VERSION_ENTRY)).toBe(VERSION);
  expect(url.searchParams.get(LANGUAGE_ENTRY)).toBe('en');
});

test('a language picked in Settings reaches the survey', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedSessions(context, buildContainer());
  await seedSettings(context, { language: 'en' });
  const page = await openPage(context, extensionId, 'index.html', POPUP);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Language"]').click();
  await page.getByRole('button', { name: 'Français', exact: true }).click();
  // The pick has reached the worker's copy before the uninstall.
  await expect
    .poll(() =>
      serviceWorker.evaluate(() =>
        chrome.storage.local
          .get('uninstallSurveyLanguage')
          .then((i) => i.uninstallSurveyLanguage)
      )
    )
    .toBe('fr');
  const url = await uninstallAndCatchSurvey(context, serviceWorker);
  expect(url.searchParams.get(VERSION_ENTRY)).toBe(VERSION);
  expect(url.searchParams.get(LANGUAGE_ENTRY)).toBe('fr');
});
