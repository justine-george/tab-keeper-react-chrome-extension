import { expect, test } from './fixtures/extension';
import { seedCorners } from './fixtures/corners';
import type { BrowserContext, Page } from '@playwright/test';

// KAN-909. The preview is the file in a sandboxed frame. Its links are for
// whoever opens the saved PDF: here they look the same and do nothing. The
// footer's "Get the extension" used to load the Web Store into the frame,
// which refuses to be framed, leaving Chrome's error page in the preview.

async function openExport(context: BrowserContext, extensionId: string) {
  await seedCorners(context, 'Chalk');
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=porto`
  );
  const frame = page.frameLocator('iframe');
  await expect(
    frame.getByRole('heading', { name: 'Porto weekend' })
  ).toBeVisible();
  return { page, frame };
}

const previewUrl = (page: Page) => page.frames()[1]?.url();

test.describe('links in the export preview (KAN-909)', () => {
  test('Get the extension does nothing here, and the preview stays', async ({
    context,
    extensionId,
  }) => {
    const { page, frame } = await openExport(context, extensionId);
    const link = frame.getByRole('link', { name: 'Get the extension' });
    // The file keeps its link for the PDF.
    await expect(link).toHaveAttribute('href', /chromewebstore\.google\.com/);
    const pages = context.pages().length;

    await link.click();
    await page.waitForTimeout(800);

    expect(previewUrl(page), 'the preview is still the file').toBe(
      'about:srcdoc'
    );
    await expect(
      frame.getByRole('heading', { name: 'Porto weekend' })
    ).toBeVisible();
    expect(context.pages().length, 'no tab opened').toBe(pages);
  });

  test('a preview link shows the ordinary pointer, not a hand', async ({
    context,
    extensionId,
  }) => {
    const { frame } = await openExport(context, extensionId);
    for (const name of ['Get the extension', 'Porto itinerary']) {
      expect(
        await frame
          .getByRole('link', { name })
          .evaluate((a) => getComputedStyle(a).cursor),
        name
      ).toBe('default');
    }
  });

  test('a tab link does nothing here either', async ({
    context,
    extensionId,
  }) => {
    const { page, frame } = await openExport(context, extensionId);
    const pages = context.pages().length;
    await frame.getByRole('link', { name: 'Porto itinerary' }).click();
    await page.waitForTimeout(800);
    expect(previewUrl(page)).toBe('about:srcdoc');
    expect(context.pages().length).toBe(pages);
  });
});
