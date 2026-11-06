import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openPage, POPUP } from './fixtures/onboarding';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-937. The status icon starts on the Sync status label's edge, with the same room before its title.

const VIEWS = [
  { name: 'popup', path: 'index.html', ...POPUP },
  { name: 'tab view', path: 'index.html?view=tab', width: 1280, height: 800 },
];

const edges = (page: Page) =>
  page.getByTestId('sync-status').evaluate((card) => {
    const textBox = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const row = card.firstElementChild!;
    const icon = row.firstElementChild!;
    const label = card.closest('[data-settings-section]')!.firstElementChild!;
    const glyph = icon.firstElementChild!.getBoundingClientRect();
    return {
      labelLeft: textBox(label).left,
      glyphLeft: glyph.left,
      gapToTitle: textBox(row.lastElementChild!).left - glyph.right,
    };
  });

for (const view of VIEWS) {
  for (const root of [16, 20]) {
    test(`${view.name} at a ${root}px root: the icon starts under the label`, async ({
      context,
      extensionId,
    }) => {
      await seedSessions(context, buildContainer());
      await seedSettings(context, { isAutoSync: false });
      const page = await openPage(context, extensionId, view.path, view);
      await page.addStyleTag({
        content: `html{font-size:${root}px !important}`,
      });
      await page.locator('[aria-label="Settings"]').click();
      await page.locator('button[aria-label="Sync & backup"]').click();
      await expect(page.getByTestId('sync-status')).toBeVisible();

      const { labelLeft, glyphLeft, gapToTitle } = await edges(page);
      expect(glyphLeft).toBeCloseTo(labelLeft, 0);
      expect(gapToTitle).toBeCloseTo(12, 0);
    });
  }
}
