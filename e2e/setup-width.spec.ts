import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Locator, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';
import { openTabGroup } from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';

// KAN-731. Setup is 580px at a 1280px window on every step, in every locale, at 16px and Chrome's Large (20px root).

// Every shipped locale, read from the folder the build copies.
const LANGS = readdirSync(
  fileURLToPath(new URL('../public/locales', import.meta.url))
).sort();

// The distinct line tops of an element's own text.
const linesOf = (el: Locator) =>
  el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
      .size;
  });

// offsetWidth: the layout box, untouched by the entrance's scale.
const layoutWidth = (el: Locator) =>
  el.evaluate((node) => {
    if (!(node instanceof HTMLElement)) throw new Error('not an HTMLElement');
    return node.offsetWidth;
  });

const boxWidth = (el: Locator) =>
  el.evaluate((node) => node.getBoundingClientRect().width);

// Setup on its first step, in one language, with all six steps.
async function openSetup(
  context: BrowserContext,
  extensionId: string,
  serviceWorker: Worker,
  lang: string
) {
  // A tab group makes the tab-groups step show.
  await openTabGroup(serviceWorker);
  await stubToolbarPin(context, { pinned: true });
  await seedSessions(context, buildContainer());
  await seedSettings(context, { setupState: 'pending', language: lang });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const dialog = page.locator('dialog[open][aria-labelledby="setup-title"]');
  await expect(dialog.getByRole('progressbar')).toHaveAttribute(
    'aria-valuemax',
    '6'
  );
  return { page, dialog };
}

test('PREMISE: all 13 locales are measured', () => {
  expect(LANGS).toHaveLength(13);
});

for (const root of [16, 20]) {
  for (const lang of LANGS) {
    test(`${lang} at a ${root}px root: setup is 580px, Skip setup one line, Next 1.5× Back, on every step`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const say = (key: string) => localeStrings(lang)[key] ?? key;
      const { page, dialog } = await openSetup(
        context,
        extensionId,
        serviceWorker,
        lang
      );
      await page.evaluate((px) => {
        document.documentElement.style.fontSize = `${px}px`;
      }, root);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize
        )
      ).toBe(`${root}px`);
      const skip = dialog.getByText(say('Skip setup'), { exact: true });
      const button = (key: string) =>
        dialog.getByRole('button', { name: say(key), exact: true });

      for (let step = 1; step <= 6; step++) {
        await expect(dialog.getByRole('progressbar')).toHaveAttribute(
          'aria-valuenow',
          String(step)
        );
        const label = `${lang} @${root}px step ${step}`;
        expect(await layoutWidth(dialog), label).toBe(580);
        expect(await linesOf(skip), label).toBe(1);
        if (step > 1) {
          const back = await boxWidth(button('Back'));
          const end = await boxWidth(button(step < 6 ? 'Next' : 'Done'));
          // CONTROL: Back is drawn, so a zero width cannot pass for a match.
          expect(back, label).toBeGreaterThan(20);
          expect(Math.abs(end - 1.5 * back), label).toBeLessThanOrEqual(1);
        }
        if (step < 6) await button('Next').click();
      }
    });
  }
}

// CONTROL: the line counter reads a wrap. de's Skip setup takes two lines in a 480px dialog.
test('CONTROL: de at 480px wraps Skip setup onto two lines', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { dialog } = await openSetup(context, extensionId, serviceWorker, 'de');
  const say = (key: string) => localeStrings('de')[key] ?? key;
  // Step 2: Back and Next share the footer with Skip setup.
  await dialog.getByRole('button', { name: say('Next'), exact: true }).click();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '2'
  );
  await dialog.evaluate((node) => {
    if (!(node instanceof HTMLElement)) throw new Error('not an HTMLElement');
    node.style.width = '480px';
  });
  expect(await layoutWidth(dialog)).toBe(480);
  const skip = dialog.getByText(say('Skip setup'), { exact: true });
  expect(await linesOf(skip)).toBe(2);
});
