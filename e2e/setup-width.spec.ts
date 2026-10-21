import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';
import { openTabGroup } from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';

// KAN-731. Setup is 560px wide at a 1280px window on every step, and Skip
// setup stays on one line there in every locale the extension ships.

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

test('PREMISE: all 13 locales are measured', () => {
  expect(LANGS).toHaveLength(13);
});

for (const lang of LANGS) {
  test(`${lang}: setup is 560px and Skip setup is one line on every step`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const say = (key: string) => localeStrings(lang)[key] ?? key;
    // A tab group makes the tab-groups step show: all six steps.
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
    const skip = dialog.getByText(say('Skip setup'), { exact: true });

    for (let step = 1; step <= 6; step++) {
      await expect(dialog.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        String(step)
      );
      const label = `${lang} step ${step}`;
      // offsetWidth: the layout box, untouched by the entrance's scale.
      expect(
        await dialog.evaluate((el) => (el as HTMLElement).offsetWidth),
        label
      ).toBe(560);
      expect(await linesOf(skip), label).toBe(1);
      if (step < 6) {
        await dialog
          .getByRole('button', { name: say('Next'), exact: true })
          .click();
      }
    }
  });
}
