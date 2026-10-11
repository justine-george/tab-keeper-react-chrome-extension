import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { RUN_FINISHED } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';
import { FULL_RUN, seedRawSettingsIfAbsent } from './fixtures/run';

// KAN-519: setup's sync caption ("Off keeps your sessions on this device. …") is one line in every locale, at Chrome's default font size.
// Setup runs only in the full view: the popup hands it there.

test.use({ freshProfile: true });

const LANGS = [
  'en',
  'de',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'sv',
  'zh',
  'zh-TW',
];
const SETTLED = {
  cloudConsent: 'declined',
  isAutoSync: false,
  isWhatsNew2Seen: true,
  hasOpenedFullView: true,
  isPinGuideDismissed: true,
  isFullViewCalloutSeen: true,
};

// Line boxes the caption's text occupies.
const lineCount = (caption: Locator) =>
  caption.evaluate((p) => {
    const range = document.createRange();
    range.selectNodeContents(p);
    return new Set(
      Array.from(range.getClientRects()).map((r) => Math.round(r.top))
    ).size;
  });

async function captionAtSyncStep(page: Page, lang: string): Promise<Locator> {
  const say = (key: string) => localeStrings(lang)[key] ?? key;
  const dialog = page.locator('dialog[open][aria-labelledby="setup-title"]');
  const link = dialog.getByRole('link', {
    name: say('privacy policy'),
    exact: true,
  });
  const progress = dialog.getByRole('progressbar');
  // Step by step, each Next waited out on the progress bar, until the sync step shows its policy link.
  for (let step = 1; !(await link.isVisible()); step++) {
    await expect(progress).toHaveAttribute('aria-valuenow', String(step));
    await dialog
      .getByRole('button', { name: say('Next'), exact: true })
      .click();
    await expect(progress).toHaveAttribute('aria-valuenow', String(step + 1));
  }
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(
    say('Sync across your devices?')
  );
  // Matched inside each <p>, so it carries no outer scope of its own.
  return dialog.locator('p', {
    has: page.getByRole('link', { name: say('privacy policy'), exact: true }),
  });
}

async function openSetup(
  page: Page,
  path: string,
  viewport: { width: number; height: number },
  extensionId: string
) {
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  await page.locator('[data-pane="sessions"]').waitFor();
}

for (const lang of LANGS) {
  test(`${lang}: the sync caption is one line`, async ({
    context,
    extensionId,
  }) => {
    await seedRawSettingsIfAbsent(context, {
      ...SETTLED,
      setupState: 'pending',
      language: lang,
      firstRun: RUN_FINISHED,
    });
    const page = await context.newPage();
    await openSetup(page, FULL_RUN.path, FULL_RUN.viewport, extensionId);
    expect(await lineCount(await captionAtSyncStep(page, lang))).toBe(1);
  });
}

// CONTROL: the count sees a wrap, so 1 above is a measurement and not a blind spot.
test('CONTROL: a caption made too long for its line counts more than one', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...SETTLED,
    setupState: 'pending',
    language: 'en',
    firstRun: RUN_FINISHED,
  });
  const page = await context.newPage();
  await openSetup(page, FULL_RUN.path, FULL_RUN.viewport, extensionId);
  const caption = await captionAtSyncStep(page, 'en');
  expect(await lineCount(caption)).toBe(1);
  await caption.evaluate((p) =>
    p.prepend('Off keeps your sessions on this device, always. ')
  );
  expect(await lineCount(caption)).toBeGreaterThan(1);
});
