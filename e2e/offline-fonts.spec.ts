import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-215. The popup and the export page must draw their icons with no network.
//
// Both fonts used to come from fonts.googleapis.com. Measured offline on a cold
// cache: both stylesheets failed with ERR_INTERNET_DISCONNECTED, and because
// the `.material-symbols-outlined` class rule lived INSIDE Google's stylesheet,
// every icon span fell back to the text font and printed its ligature name --
// "search", "sort", "settings" over the title, "library_add" running into the
// right pane. It never recovered.
//
// A glyph lays out at the icon box's width (24px); its name is wider (search:
// 75px offline). That width is what tells the two apart, and it is read after
// the fonts have loaded, which on the old build never happens.

const SESSION = buildSession({
  tabGroupId: 's0',
  title: 'Weekend in Kyoto',
  isSelected: true,
});

/** Every visible icon: its ligature, its box width, its laid-out text width. */
async function iconWidths(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('span.material-symbols-outlined')]
      .map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return {
          name: el.textContent,
          box: el.getBoundingClientRect().width,
          text: range.getBoundingClientRect().width,
        };
      })
      .filter((icon) => icon.box > 0)
  );
}

async function expectGlyphs(page: Page) {
  await waitForFontsLoaded(page);
  const icons = await iconWidths(page);
  // CONTROL: an empty list would pass every per-icon assertion below.
  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) {
    expect(icon.text, `"${icon.name}" drew as text`).toBeLessThanOrEqual(
      icon.box + 1
    );
  }
}

test.describe('fonts ship with the extension', () => {
  test.beforeEach(async ({ context }) => {
    await seedSessions(context, {
      ...buildContainer([SESSION]),
      selectedTabGroupId: 's0',
    });
  });

  test('offline, the popup draws its icons as glyphs', async ({
    context,
    extensionId,
  }) => {
    await context.setOffline(true);
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.getByText('Weekend in Kyoto').first()).toBeVisible();

    await expectGlyphs(page);
  });

  test('offline, the export page draws its icons as glyphs', async ({
    context,
    extensionId,
  }) => {
    await context.setOffline(true);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/export.html?session=s0`);
    await expect(page.getByText('Weekend in Kyoto').first()).toBeVisible();

    await expectGlyphs(page);
  });

  test('online, neither page requests a font from Google', async ({
    context,
    extensionId,
  }) => {
    const requested: string[] = [];
    context.on('request', (request) => requested.push(request.url()));

    for (const path of ['index.html', 'export.html?session=s0']) {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      await expect(page.getByText('Weekend in Kyoto').first()).toBeVisible();
      await waitForFontsLoaded(page);
      await page.close();
    }

    // CONTROL: the listener must see the pages' own requests, or an empty
    // Google list proves nothing.
    expect(
      requested.filter((url) => url.startsWith('chrome-extension://'))
    ).not.toHaveLength(0);
    expect(
      requested.filter((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))
    ).toEqual([]);
  });
});
