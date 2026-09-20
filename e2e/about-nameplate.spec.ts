import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';
import { DARKENHEIMER_THEME, LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-241. Settings -> About is laid out like the other four panes -- a
// left-aligned section under the shared inset -- with a nameplate on top: the
// app's mark drawn in the page's ink beside "Tab Keeper", and the version and
// credit on one line under it.
//
// Measured before the change (main a0406d8, 790x550): the pane held ~210px of
// content and ~250px of gap, centred where every other pane is left-aligned,
// and the version sat at the floor in LABEL_L3 -- 2.56:1 on Paper, 2.69:1 on
// Graphite -- so the one line a bug report needs was the hardest to read.
//
// The component test pins tokens and strings. This pins what only a layout
// engine can say: that About's inset IS the Display pane's inset, that the mark
// sits on the name line, and that the stack is the Backup & Restore stack.

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

async function openSettings(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string,
  theme: 'Light' | 'Darkenheimer'
): Promise<Page> {
  await seedSessions(context);
  await seedSettings(context, { theme });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Themes')).toBeVisible();
  return page;
}

async function openAbout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.getByText('Tab Keeper', { exact: true })).toBeVisible();
}

/** The nameplate's mark: the one svg on the page that is not inside a button. */
const mark = (page: Page) => page.locator('svg:not(button svg)');

const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!;

for (const [theme, palette] of [
  ['Light', LIGHT_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
] as const) {
  test.describe(`Settings -> About on ${theme}`, () => {
    test('shares the Display pane inset instead of centring', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      const themes = await box(page.getByText('Themes', { exact: true }));

      await openAbout(page);
      const glyph = await box(mark(page));
      const label = await box(page.getByText('Feedback & Share'));
      const rate = await box(
        page.getByRole('button', { name: 'Rate this extension' })
      );

      // The same left edge the Display pane's first label has.
      expect(glyph.x).toBe(themes.x);
      expect(label.x).toBe(themes.x);
      expect(rate.x).toBe(themes.x);
    });

    test('puts the mark on the name line, in the text colour, at ICON.DEFAULT', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const glyph = mark(page);
      const g = await box(glyph);
      const name = await box(page.getByText('Tab Keeper', { exact: true }));

      expect(g.width).toBe(24);
      expect(g.height).toBe(24);
      // Vertically centred on the name, not on the two-line block.
      const gMid = g.y + g.height / 2;
      const nMid = name.y + name.height / 2;
      expect(Math.abs(gMid - nMid)).toBeLessThanOrEqual(1);
      // Drawn with currentColor, so the svg's own colour is what paints it.
      expect(await glyph.evaluate((el) => getComputedStyle(el).color)).toBe(
        rgb(palette.TEXT_COLOR)
      );
    });

    test('sets the version in LABEL_L1 directly under the name', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const version = page.getByText(/^v\d+\.\d+\.\d+$/);
      // The name row is the Icon's 32px box with the name centred on it.
      const row = await box(
        page
          .getByText('Tab Keeper', { exact: true })
          .locator('..')
          .locator('..')
      );
      const v = await box(version);

      expect(await version.evaluate((el) => getComputedStyle(el).color)).toBe(
        rgb(palette.LABEL_L1_COLOR)
      );
      // On the next line, not at the floor: the version's line starts 6px
      // under the name row. The LINE, not the version's own span: the credit
      // beside it carries an emoji, whose taller line box the span is centred
      // within (3px lower, measured).
      const line = await box(version.locator('..').locator('..'));
      expect(row.height).toBe(32);
      expect(line.y).toBe(row.y + row.height + 6);
      expect(v.y).toBeGreaterThanOrEqual(line.y);
      expect(v.y + v.height).toBeLessThanOrEqual(line.y + line.height);
    });

    test('stacks the three actions the way Backup & Restore does', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const rate = await box(
        page.getByRole('button', { name: 'Rate this extension' })
      );
      const mail = await box(
        page.getByRole('button', { name: 'Share your feedback' })
      );
      const x = await box(page.getByRole('button', { name: 'Share on X' }));
      const label = await box(page.getByText('Feedback & Share'));
      const credit = await box(page.getByText(/Crafted with/).locator('..'));

      // One CONTROL.ROW under the nameplate, not the 20px two settings get:
      // a header wants more under it than a setting does.
      expect(label.y).toBe(credit.y + credit.height + 32);

      for (const b of [rate, mail, x]) {
        expect(b.width).toBe(250);
        expect(b.height).toBe(48);
      }
      expect(rate.y).toBe(label.y + label.height + 8);
      expect(mail.y).toBe(rate.y + 48 + 12);
      expect(x.y).toBe(mail.y + 48 + 12);
    });
  });
}

test('the thank-you heading is gone', async ({ context, extensionId }) => {
  const page = await openSettings(context, extensionId, 'Light');
  await openAbout(page);

  await expect(page.getByText(/Thank you for using/)).toHaveCount(0);
});
