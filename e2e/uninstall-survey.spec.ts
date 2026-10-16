import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { POPUP, openPage } from './fixtures/onboarding';

// KAN-642. Uninstalling opens the feedback form, stamped with this build's
// version and the language Tab Keeper was showing.
// KAN-643. Each install opens one of two forms, drawn once and kept.

const VERSION: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../dist/manifest.json', import.meta.url)),
    'utf8'
  )
).version;

const FORM = 'https://docs.google.com/forms/**';
const FORM_A =
  'https://docs.google.com/forms/d/e/1FAIpQLSfkdlOu5hLRrU9Xa-bRRq-bIVDZHwybbqDaHYfHWdwqOLz9NQ/viewform';
const FORM_B =
  'https://docs.google.com/forms/d/e/1FAIpQLSfoquF4VOaq-HITFlVMgNLdoq_V1w3UQcrrNuFIB4bzx5mEmg/viewform';
const FORM_KEY = 'uninstallSurveyForm';
const VERSION_ENTRY = 'entry.289476948';
const LANGUAGE_ENTRY = 'entry.19370289';

// The URL the worker last set, once every queued apply has settled.
const surveySet = (worker: Worker) =>
  worker.evaluate(async () => {
    const applied: unknown = Reflect.get(
      globalThis,
      'tabKeeperUninstallSurveyApplied'
    );
    if (typeof applied !== 'function')
      throw new Error('no tabKeeperUninstallSurveyApplied');
    const url: unknown = await applied();
    return typeof url === 'string' ? url : undefined;
  });

const storedForm = (worker: Worker) =>
  worker.evaluate(
    (key) => chrome.storage.local.get(key).then((items) => items[key]),
    FORM_KEY
  );

const formBase = (url: URL) => `${url.origin}${url.pathname}`;

// Re-applies through the worker's language listener, with the next draw pinned.
const reapplyWithDraw = (worker: Worker, draw: number, language: string) =>
  worker.evaluate(
    ([d, l]) => {
      Math.random = () => d;
      return chrome.storage.local.set({ uninstallSurveyLanguage: l });
    },
    [draw, language] as const
  );

// What Chrome opens once the extension is gone. The evaluate rejects: the worker dies with it.
async function uninstallAndCatchSurvey(
  context: BrowserContext,
  worker: Worker,
  language: string
): Promise<URL> {
  // Chrome opens nothing before the worker's apply lands (3 of 25 under load, without this).
  await expect
    .poll(async () => {
      const set = await surveySet(worker);
      return set && new URL(set).searchParams.get(LANGUAGE_ENTRY);
    })
    .toBe(language);
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
  const url = await uninstallAndCatchSurvey(context, serviceWorker, 'en');
  expect(url.searchParams.get(VERSION_ENTRY)).toBe(VERSION);
  expect(url.searchParams.get(LANGUAGE_ENTRY)).toBe('en');
});

test('the install drew a form, stored it, and that form opens', async ({
  context,
  serviceWorker,
}) => {
  await expect.poll(() => storedForm(serviceWorker)).toMatch(/^[ab]$/);
  const form = await storedForm(serviceWorker);
  const url = await uninstallAndCatchSurvey(context, serviceWorker, 'en');
  expect(formBase(url)).toBe(form === 'a' ? FORM_A : FORM_B);
});

test('a stored form outlives a re-apply that would draw the other', async ({
  context,
  serviceWorker,
}) => {
  await expect.poll(() => storedForm(serviceWorker)).toMatch(/^[ab]$/);
  await serviceWorker.evaluate(
    (key) => chrome.storage.local.set({ [key]: 'b' }),
    FORM_KEY
  );
  // A draw of 0 is form A: only the stored B can open.
  await reapplyWithDraw(serviceWorker, 0, 'fr');
  const url = await uninstallAndCatchSurvey(context, serviceWorker, 'fr');
  expect(formBase(url)).toBe(FORM_B);
});

test('no stored form: the worker draws one and stores it', async ({
  context,
  serviceWorker,
}) => {
  await expect.poll(() => storedForm(serviceWorker)).toMatch(/^[ab]$/);
  await serviceWorker.evaluate(
    (key) => chrome.storage.local.remove(key),
    FORM_KEY
  );
  // CONTROL: the removal took.
  expect(await storedForm(serviceWorker)).toBeUndefined();
  await reapplyWithDraw(serviceWorker, 0, 'de');
  await expect.poll(() => storedForm(serviceWorker)).toBe('a');
  await serviceWorker.evaluate(
    (key) => chrome.storage.local.remove(key),
    FORM_KEY
  );
  await reapplyWithDraw(serviceWorker, 0.9, 'fr');
  await expect.poll(() => storedForm(serviceWorker)).toBe('b');
  const url = await uninstallAndCatchSurvey(context, serviceWorker, 'fr');
  expect(formBase(url)).toBe(FORM_B);
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
  const url = await uninstallAndCatchSurvey(context, serviceWorker, 'fr');
  expect(url.searchParams.get(VERSION_ENTRY)).toBe(VERSION);
  expect(url.searchParams.get(LANGUAGE_ENTRY)).toBe('fr');
});
