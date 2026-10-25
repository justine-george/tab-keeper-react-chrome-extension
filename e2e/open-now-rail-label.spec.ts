import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { localeStrings, shippedLanguages } from './fixtures/locales';
import { FULL_VIEW_PATH } from './fixtures/onboarding';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { expectReadable } from './fixtures/textContrast';

// KAN-776 C on the real artifact. Below 1100px Open now is a 44px rail, shown
// only beside a selected session; its button shows the glyph and, under it,
// "Open now" set vertically. What jsdom cannot show: the label's real box in
// every shipped locale, and its contrast on each theme's painted ground.

const RAIL_VIEWPORT = { width: 1000, height: 700 };
const SESSION = 'Q4 product roadmap';
const THEMES = [
  'Chalk',
  'Light',
  'WarmLight',
  'BBPink',
  'Charcoal',
  'Darkenheimer',
  'Blue',
] as const;

async function openRail(
  context: BrowserContext,
  extensionId: string,
  { theme = 'Chalk', language = 'en' } = {}
): Promise<{ page: Page; rail: Locator; label: Locator }> {
  const strings = localeStrings(language);
  await seedSettings(context, { theme, language });
  await seedSessions(
    context,
    buildContainer([buildSession({ tabGroupId: 'q4', title: SESSION })])
  );
  const page = await context.newPage();
  await page.setViewportSize(RAIL_VIEWPORT);
  await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
  // CONTROL: the seeded language took, so a German run is not passing in English.
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await page
    .locator('[data-pane="sessions"] button')
    .filter({ hasText: SESSION })
    .first()
    .click();
  const rail = page.locator('[data-pane="open-now"] button[aria-expanded]');
  await expect(rail).toHaveCount(1);
  // The count arrives with the first read; a name without it is mid-flight.
  await expect(rail).toHaveAccessibleName(/, /);
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  const label = rail.getByText(strings['Open now'], { exact: true });
  await expect(label).toBeVisible();
  return { page, rail, label };
}

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('no box');
  return box;
};

for (const language of shippedLanguages()) {
  test(`${language}: the label reads top to bottom under the glyph and fits the rail`, async ({
    context,
    extensionId,
  }) => {
    const strings = localeStrings(language);
    const { page, rail, label } = await openRail(context, extensionId, {
      language,
    });
    const slot = page.locator('[data-pane="open-now"]');
    const glyph = rail.locator('.material-symbols-outlined');

    expect(await label.evaluate((el) => getComputedStyle(el).writingMode)).toBe(
      'vertical-rl'
    );
    // WCAG 2.5.3: the name a voice user speaks starts with what they see.
    const name = await rail.evaluate((el) => el.getAttribute('aria-label'));
    expect(name?.startsWith(`${strings['Open now']}, `), String(name)).toBe(
      true
    );

    const [l, g, b, s] = await Promise.all([
      boxOf(label),
      boxOf(glyph),
      boxOf(rail),
      boxOf(slot),
    ]);
    console.log(
      `[rail] ${language}: button ${b.width}x${b.height}, label ${l.width}x${l.height}`
    );
    expect(l.height, 'set vertically').toBeGreaterThan(l.width);
    expect(l.y, 'under the glyph').toBeGreaterThanOrEqual(g.y + g.height);
    expect(l.x).toBeGreaterThanOrEqual(b.x);
    expect(l.x + l.width).toBeLessThanOrEqual(b.x + b.width);
    expect(l.y + l.height).toBeLessThanOrEqual(b.y + b.height);
    expect(b.x, 'inside the rail').toBeGreaterThanOrEqual(s.x);
    expect(b.x + b.width).toBeLessThanOrEqual(s.x + s.width);
    expect(b.y + b.height, 'on screen').toBeLessThanOrEqual(
      RAIL_VIEWPORT.height
    );
    // Nothing clipped inside its own box.
    const clipped = await label.evaluate(
      (el) =>
        el.scrollWidth > el.clientWidth + 1 ||
        el.scrollHeight > el.clientHeight + 1
    );
    expect(clipped).toBe(false);
  });
}

for (const theme of THEMES) {
  test(`${theme}: the label reads at 4.5:1 at rest and on hover`, async ({
    context,
    extensionId,
  }) => {
    const { page, rail } = await openRail(context, extensionId, { theme });
    await page.mouse.move(500, 690);
    await expectReadable(rail, `rail at rest on ${theme}`);
    await rail.hover();
    // PREMISE: the hover fill is on, so this measures against it.
    await expect
      .poll(() => rail.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    await expectReadable(rail, `rail on hover on ${theme}`);
  });
}
