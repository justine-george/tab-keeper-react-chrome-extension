import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-236. A settings category row answers a press, as every other row has
// since KAN-205. It did not: the row had the KAN-96 hover fix and its selected
// fill, and no :active rule at all -- pressing and holding showed the hover
// fill and nothing more. Justine found it on the settings page after the
// home page had been fixed.
//
// Real pixels under a held pointer, because the fill eases in over a
// transition and jsdom paints nothing: the jsdom case pins that the rule is
// emitted, this pins that Chrome paints it.

const hex = (h: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;

const ACTIVE = hex(LIGHT_THEME.ACTIVE_COLOR);
const HOVER = hex(LIGHT_THEME.HOVER_COLOR);
const SELECTION = hex(LIGHT_THEME.SELECTION_COLOR);

const fillOf = (row: Locator) =>
  row.evaluate((el) => getComputedStyle(el).backgroundColor);

// The fill eases over DURATION.MOVE; read it once it has settled to the
// expected colour rather than mid-curve.
const expectFill = (row: Locator, colour: string) =>
  expect.poll(() => fillOf(row), { timeout: 2000 }).toBe(colour);

async function openSettings(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Display' })).toBeVisible();
  return page;
}

async function pressAndHold(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test.describe('a settings category row answers a press (KAN-236)', () => {
  test('an unselected row: hover, then a darker press, then hover again', async ({
    context,
    extensionId,
  }) => {
    const page = await openSettings(context, extensionId);
    const row = page.getByRole('button', { name: 'Sync & Backup' });

    await row.hover();
    await expectFill(row, HOVER);

    await pressAndHold(page, row);
    await expectFill(row, ACTIVE);
    // PREMISE, and the whole complaint: the press is a DIFFERENT colour from
    // the hover, or holding the row would look like resting on it.
    expect(ACTIVE).not.toBe(HOVER);

    await page.mouse.up();
    // Release selects Sync & Privacy; the pointer is still on it. Its fill is
    // now the selected one -- a selected row shows no hover (KAN-96).
    await expectFill(row, SELECTION);
  });

  test('the selected row presses too', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId);
    const row = page.getByRole('button', { name: 'Display' });
    await expectFill(row, SELECTION);

    await pressAndHold(page, row);
    await expectFill(row, ACTIVE);

    await page.mouse.up();
    await expectFill(row, SELECTION);
  });

  // CONTROL: the same colour, painted the same way, is what a session row in
  // the home pane has shown under a press since KAN-205. If Chrome painted
  // nothing there, the settings rows above would be passing on a colour that
  // does not exist. That row paints its fill as an inset box-shadow (KAN-82),
  // not a background, so the read differs; the colour must not.
  test('CONTROL: a session row in the home pane presses in the same colour', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // The fill is on the row that WRAPS the button, as row-state-feedback.spec
    // reads it; the button itself paints nothing.
    const row = page
      .getByRole('button', { name: 'Research', exact: true })
      .locator('..');
    await expect(row).toBeVisible();

    await pressAndHold(page, row);
    await expect
      .poll(() => row.evaluate((el) => getComputedStyle(el).boxShadow), {
        timeout: 2000,
      })
      .toContain(ACTIVE);
    await page.mouse.up();
  });
});
