import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions } from './fixtures/seed';

// KAN-240. The settings page's header "Back" control was a <button> reset to padding: 0, so its hit area was exactly its
// content: 81x32 inside a 56px row with nothing beside it. A click a few
// pixels off the label did nothing, and with no hover fill there was nothing
// to say where the target ended.
//
// The target now spans the row's full height and reaches 8px left (into the
// pane's padding, as KAN-231 did for the group strip) and 16px right past the
// label. Asserted by clicking there and watching the page go back, because a
// box measurement alone would pass against a button whose padding grew but
// whose onClick did not cover it. The layout assertions are the other half:
// growing the target must not move the glyph or the label.

async function openSettings(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Themes')).toBeVisible();
  return page;
}

const back = (page: Page): Locator =>
  page.getByRole('button', { name: 'Go back' });

// The header row the control sits in: the Back is wrapped in a div inside it.
const rowOf = (control: Locator): Locator =>
  control.locator('..').locator('..');

// exact: the glyph's ligature text "arrow_back" substring-matches "Back" too.
const label = (control: Locator): Locator =>
  control.getByText('Back', { exact: true });

// The Icon is the button's first child: a 32px box around the ligature.
const glyphOf = (control: Locator): Locator => control.locator('xpath=./*[1]');

test.describe('the Back control on the settings page', () => {
  test('is as tall as its row and reaches past its glyph and label', async ({
    context,
    extensionId,
  }) => {
    const page = await openSettings(context, extensionId);
    const control = back(page);
    const box = (await control.boundingBox())!;
    const row = (await rowOf(control).boundingBox())!;
    const text = (await label(control).boundingBox())!;

    expect(box.height).toBe(row.height);
    expect(box.y).toBe(row.y);
    // 8px left of the row's content edge, 16px right of the label.
    expect(box.x).toBe(row.x - 8);
    expect(box.x + box.width).toBe(text.x + text.width + 16);
  });

  test('a click beside the label, where nothing used to happen, goes back', async ({
    context,
    extensionId,
  }) => {
    const page = await openSettings(context, extensionId);
    const text = (await label(back(page)).boundingBox())!;

    // 10px past the label's right edge and 6px below its baseline box:
    // outside the old 81x32 target on both axes.
    await page.mouse.click(text.x + text.width + 10, text.y + text.height + 6);

    await expect(page.getByText('Themes')).toHaveCount(0);
  });

  test('growing the target moved neither the glyph nor the label', async ({
    context,
    extensionId,
  }) => {
    const page = await openSettings(context, extensionId);
    const control = back(page);
    const row = (await rowOf(control).boundingBox())!;
    const glyph = (await glyphOf(control).boundingBox())!;
    const text = (await label(control).boundingBox())!;

    // The glyph sits flush with the row's content edge, the label 8px
    // after the 32px glyph, both vertically centred in the 56px row:
    // exactly where they were.
    expect(glyph.x).toBe(row.x);
    expect(text.x).toBe(row.x + 32 + 8);
    expect(glyph.y + glyph.height / 2).toBe(row.y + row.height / 2);
    expect(row.height).toBe(56);
  });
});
