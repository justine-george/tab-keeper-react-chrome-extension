import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import { afterPress, type Seen } from './fixtures/pickRecord';
import { EASE } from '../src/styles/scale';

// KAN-1031 on the real artifact. A language pick: the new cell's check pops in
// (half size to full, 200 ms; fade 120 ms), its fill fading as buttons do; the
// page cross-fades to the new words with a soft blur (250 ms, 2px), held until
// the new language is drawn. Picking the current language moves nothing.
// Reduced motion keeps all of it still.

const cell = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole('button', { name, exact: true });

const lang = (page: Page) => page.evaluate(() => document.documentElement.lang);

async function openLanguages(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(cell(page, 'Deutsch')).toBeVisible();
  await page.mouse.move(0, 0);
}

function expectPickMotion(seen: Seen[], to: string) {
  // The check pops in on the new cell.
  expect(seen.filter((s) => s.who === `${to} check`)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        duration: 120,
        keyframes: [
          expect.objectContaining({ opacity: '0' }),
          expect.objectContaining({ opacity: '1' }),
        ],
      }),
      expect.objectContaining({
        duration: 200,
        easing: EASE.OUT,
        keyframes: [
          expect.objectContaining({ transform: 'scale(0.5)' }),
          expect.objectContaining({ transform: 'none' }),
        ],
      }),
    ])
  );
  // The page: old words blur out, new ones blur in, 250 ms each.
  const fade = seen.filter((s) => s.who === 'page');
  const of = (pseudo: string) => fade.find((f) => f.pseudo === pseudo);
  expect(of('::view-transition-old(root)')).toEqual(
    expect.objectContaining({
      duration: 250,
      keyframes: [
        expect.anything(),
        expect.objectContaining({ opacity: '0', filter: 'blur(2px)' }),
      ],
    })
  );
  expect(of('::view-transition-new(root)')).toEqual(
    expect.objectContaining({
      duration: 250,
      keyframes: [
        expect.objectContaining({ opacity: '0', filter: 'blur(2px)' }),
        expect.anything(),
      ],
    })
  );
}

test.describe('Settings › Language (popup)', () => {
  test('a pick pops the check in and blurs the words over to the new language', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { language: 'en' });
    const page = await context.newPage();
    await openLanguages(page, extensionId);

    const seen = await afterPress(page, cell(page, 'Deutsch'));
    expectPickMotion(seen, 'Deutsch');
    expect(await lang(page)).toBe('de');
    await expect(cell(page, 'Deutsch')).toHaveAttribute('aria-pressed', 'true');
    await expect(cell(page, 'English')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.hasAttribute('data-page-fade')
        )
      )
      .toBe(false);
  });

  test('picking the language already picked moves nothing', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { language: 'en' });
    const page = await context.newPage();
    await openLanguages(page, extensionId);

    expect(await afterPress(page, cell(page, 'English'))).toEqual([]);
    expect(await lang(page)).toBe('en');
  });

  test('a second pick from the keyboard mid-fade lands, and the fade ends clean', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { language: 'en' });
    const page = await context.newPage();
    await openLanguages(page, extensionId);

    await cell(page, 'Deutsch').click();
    // Mid-fade: Español, the cell after Deutsch, with the keys.
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() =>
        document.documentElement.hasAttribute('data-page-fade')
      )
    ).toBe(true);
    await page.keyboard.press('Enter');

    await expect.poll(() => lang(page)).toBe('es');
    await expect(cell(page, 'Español')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.hasAttribute('data-page-fade')
        )
      )
      .toBe(false);
  });
});

test.describe('the setup dialog (full view)', () => {
  test('the page blurs over to the new words as one picture', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, {
      language: 'en',
      setupState: 'pending',
      hasOpenedFullView: true,
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    const setup = page.getByRole('dialog', { name: 'Make Tab Keeper yours' });
    await setup.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(cell(setup, '日本語')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);

    const seen = await afterPress(page, cell(setup, '日本語'));
    expectPickMotion(seen, '日本語');
    expect(
      seen.filter((s) => s.who === 'page' && s.pseudo?.includes('pane-'))
    ).toEqual([]);
    expect(await lang(page)).toBe('ja');
  });
});

test.describe('reduce motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a language pick changes everything at once', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { language: 'en' });
    const page = await context.newPage();
    await openLanguages(page, extensionId);

    // Only the cells' own colour fade, as for any button: no pop, no page fade.
    const seen = await afterPress(page, cell(page, 'Deutsch'));
    expect(seen.filter((s) => !s.who.endsWith(' cell'))).toEqual([]);
    expect(await lang(page)).toBe('de');
    await expect(cell(page, 'Deutsch')).toHaveAttribute('aria-pressed', 'true');
  });
});
