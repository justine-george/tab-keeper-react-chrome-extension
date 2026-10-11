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

// The policy URL as a literal, not common.ts's PRIVACY_POLICY_LINK: importing
// common.ts pulls manifest.json into Node ESM, which refuses it without an
// import attribute. And this is the one URL that is pasted into the Web Store
// dashboard, so the spec pinning it to the letter is the point.
const PRIVACY_POLICY_LINK =
  'https://github.com/justine-george/tab-keeper-react-chrome-extension/blob/main/PRIVACY.md';

/** The nameplate's mark (KAN-521): the header's, shutter and all. */
const mark = (page: Page) =>
  page.locator('svg:has([data-mark-part="shutter"])');
const versionLine = (page: Page) => page.getByText(/^Version \d+\.\d+\.\d+$/);
const credit = (page: Page) =>
  page.getByRole('img', { name: 'love' }).locator('..');

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
      const label = await box(page.getByText('Feedback', { exact: true }));
      const rate = await box(
        page.getByRole('button', { name: 'Rate this extension' })
      );

      // The same left edge the Display pane's first label has.
      expect(glyph.x).toBe(themes.x);
      expect(label.x).toBe(themes.x);
      expect(rate.x).toBe(themes.x);
    });

    // KAN-521. Option C: the 40px mark beside the name, with the version under the name.
    test('puts the 40px mark beside the name and the version, centred on the pair', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const g = await box(mark(page));
      const name = await box(page.getByText('Tab Keeper', { exact: true }));
      const v = await box(versionLine(page));

      expect(g.width).toBe(40);
      expect(g.height).toBe(40);
      expect(name.x).toBe(g.x + 40 + 12);
      expect(v.x).toBe(name.x);
      const pairMid = (name.y + v.y + v.height) / 2;
      expect(Math.abs(g.y + g.height / 2 - pairMid)).toBeLessThanOrEqual(1);
    });

    test('sets the version in LABEL_L1 right under the name', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const version = versionLine(page);
      const name = await box(page.getByText('Tab Keeper', { exact: true }));
      const v = await box(version);

      expect(await version.evaluate((el) => getComputedStyle(el).color)).toBe(
        rgb(palette.LABEL_L1_COLOR)
      );
      expect(Math.abs(v.y - (name.y + name.height + 2))).toBeLessThanOrEqual(1);
    });

    test('the credit is its own line on the inset, its heart drawn in LABEL_L2', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      const themes = await box(page.getByText('Themes', { exact: true }));
      await openAbout(page);

      const c = await box(credit(page));
      const g = await box(mark(page));
      expect(c.x).toBe(themes.x);
      expect(c.y).toBe(g.y + g.height + 14);
      const heart = page.getByRole('img', { name: 'love' });
      expect(await heart.evaluate((el) => getComputedStyle(el).color)).toBe(
        rgb(palette.LABEL_L2_COLOR)
      );
      await expect(credit(page)).toHaveText(/^Made with\s+by Justine George$/);
    });

    // KAN-260. A third line: the policy link, on the inset, 6px under the
    // version line, in the text colour so it reads as a link beside two labels
    // in LABEL_L1/L2. It opens the policy in a tab and leaves the popup where
    // it is -- a popup that follows a link navigates itself away.
    test('links the privacy policy under the credit, on the inset', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      const themes = await box(page.getByText('Themes', { exact: true }));
      await openAbout(page);

      const link = page.getByRole('link', { name: 'Privacy policy' });
      const line = await box(credit(page));
      const l = await box(link);

      expect(l.x).toBe(themes.x);
      expect(l.y).toBe(line.y + line.height + 6);
      expect(await link.evaluate((el) => getComputedStyle(el).color)).toBe(
        rgb(palette.TEXT_COLOR)
      );
      expect(await link.getAttribute('href')).toBe(PRIVACY_POLICY_LINK);

      // No network: the tab's navigation is answered locally, so what is
      // pinned is the URL Chrome was told to open, not GitHub's availability.
      await context.route('https://github.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '' })
      );
      const opened = context.waitForEvent('page');
      await link.click();
      const tab = await opened;
      await expect.poll(() => tab.url()).toBe(PRIVACY_POLICY_LINK);
      // The popup is still the popup.
      expect(page.url()).toBe(`chrome-extension://${extensionId}/index.html`);
      await expect(page.getByText('Feedback', { exact: true })).toBeVisible();
    });

    test('stacks the two actions the way Backup & Restore does', async ({
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
      const label = await box(page.getByText('Feedback', { exact: true }));
      const policy = await box(
        page.getByRole('link', { name: 'Privacy policy' })
      );

      // One CONTROL.ROW under the nameplate -- whose last line is now the
      // policy link (KAN-260) -- not the 20px two settings get: a header wants
      // more under it than a setting does.
      expect(label.y).toBe(policy.y + policy.height + 32);

      for (const b of [rate, mail]) {
        expect(b.width).toBe(250);
        expect(b.height).toBe(48);
      }
      expect(rate.y).toBe(label.y + label.height + 8);
      expect(mail.y).toBe(rate.y + 48 + 12);
      // KAN-511. Share on X is gone.
      await expect(
        page.getByRole('button', { name: 'Share on X' })
      ).toHaveCount(0);
    });

    // KAN-511. Rate is the filled main action: the theme's text colour as the fill, its ground as the ink.
    test('Rate is the filled button with the star, in this theme’s colours', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);
      const rate = page.getByRole('button', { name: 'Rate this extension' });

      const drawn = await rate.evaluate((el) => {
        const glyph = el.querySelector('.material-symbols-outlined');
        return {
          fill: getComputedStyle(el).backgroundColor,
          ink: getComputedStyle(el).color,
          glyph: glyph?.textContent,
          glyphInk: glyph ? getComputedStyle(glyph).color : null,
        };
      });
      const rgb = (hex: string) =>
        `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      expect(drawn).toEqual({
        fill: rgb(palette.TEXT_COLOR),
        ink: rgb(palette.PRIMARY_COLOR),
        glyph: 'star',
        glyphInk: rgb(palette.PRIMARY_COLOR),
      });
    });
  });
}

test('the thank-you heading is gone', async ({ context, extensionId }) => {
  const page = await openSettings(context, extensionId, 'Light');
  await openAbout(page);

  await expect(page.getByText(/Thank you for using/)).toHaveCount(0);
});

// KAN-521. A click on About's mark plays the header's beat, and the shutter click once it has shut.
test('a click on the About mark slides its shutter, then clicks once as it shuts', async ({
  context,
  extensionId,
}) => {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const log: { what: string; at: number }[] = [];
    Object.defineProperty(window, '__beat', { value: log });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.getAttribute('data-mark-part') === 'shutter')
        log.push({ what: 'shutter', at: performance.now() });
      return animate.call(this, keyframes, options);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      log.push({ what: 'tick', at: performance.now() });
      start.call(this, when, offset, duration);
    };
  });
  const page = await openSettings(context, extensionId, 'Light');
  await openAbout(page);
  await mark(page).click();

  const read = () =>
    page.evaluate(
      () => Reflect.get(window, '__beat') as { what: string; at: number }[]
    );
  await expect.poll(async () => (await read()).length).toBe(3);
  const log = await read();
  const shutter = log.find((e) => e.what === 'shutter')!;
  const ticks = log.filter((e) => e.what === 'tick');
  // PREMISE: the shutter slid, and one click (two ticks) sounded.
  expect(shutter).toBeDefined();
  expect(ticks).toHaveLength(2);
  // The 60ms delay plus the 300ms slide: the click once it has shut, not as it starts.
  expect(ticks[0].at - shutter.at).toBeGreaterThanOrEqual(340);
});
